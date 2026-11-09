import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DayOfWeek,
  InstructorTimeOff,
  Prisma,
  User,
  UserRole,
} from '@prisma/client';
import {
  lockScheduleResources,
  scheduleLockKey,
} from '../../common/prisma/schedule-lock';
import { addDays, startOfLocalDay } from '../../common/time/zoned-time';
import { PrismaService } from '../../prisma/prisma.service';
import { INSTRUCTOR_NOT_FOUND_MESSAGE } from '../cars/cars.service';
import {
  CreateTimeOffDto,
  ReplaceWorkingHoursDto,
  TIME_OFF_MAX_DAYS,
  TimeOffDto,
  TimeOffListDto,
  TimeOffListQueryDto,
  WorkingHoursDto,
  WorkingHoursIntervalDto,
} from './instructor-schedule.dto';
import { LESSON_MIN_DURATION_MIN, REQUIRED_FIELD_MESSAGE } from './lessons.dto';
import { requireInstructor } from './practice-rules';
import {
  ScheduleSlot,
  findTimeOffConflicts,
  scheduleConflict,
} from './schedule-conflicts';
import { fieldError, resolveRange } from './schedule-range';

export const SCHEDULE_MANAGE_ROLES = [UserRole.ADMIN] as const;
export const SCHEDULE_VIEW_ROLES = [
  UserRole.ADMIN,
  UserRole.INSTRUCTOR,
] as const;

export const TIME_OFF_NOT_FOUND_MESSAGE = 'Time off not found';
export const WORKING_HOURS_ORDER_MESSAGE = 'end має бути пізніше за start.';
export const WORKING_HOURS_LENGTH_MESSAGE = `Інтервал має тривати щонайменше ${LESSON_MIN_DURATION_MIN} хвилин.`;
export const WORKING_HOURS_OVERLAP_MESSAGE =
  'Інтервали одного дня перетинаються.';
export const TIME_OFF_FORM_MESSAGE =
  'Передайте або startDate (і за потреби endDate), або startsAt і endsAt.';
export const TIME_OFF_DATE_ORDER_MESSAGE =
  'endDate має бути не раніше за startDate.';
export const TIME_OFF_INSTANT_ORDER_MESSAGE =
  'endsAt має бути пізніше за startsAt.';
export const TIME_OFF_LENGTH_MESSAGE = `Недоступність має бути не довшою за ${TIME_OFF_MAX_DAYS} днів.`;
export const TIME_OFF_IN_PAST_MESSAGE =
  'Недоступність уже закінчилася: її не можна додати.';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Порядок днів тижня — як в enum (з понеділка). */
const DAY_ORDER: readonly DayOfWeek[] = Object.values(DayOfWeek);

export type WorkingInterval = {
  dayOfWeek: DayOfWeek;
  startMinute: number;
  endMinute: number;
};

const timeOffSelect = {
  id: true,
  instructorId: true,
  type: true,
  reason: true,
  startsAt: true,
  endsAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.InstructorTimeOffSelect;

type TimeOffRow = Pick<InstructorTimeOff, keyof typeof timeOffSelect>;

/** "09:00" → 540. Формат уже перевірив DTO. */
export function parseClock(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

/** 540 → "09:00", 1440 → "24:00". */
export function formatClock(minute: number): string {
  const hours = String(Math.floor(minute / 60)).padStart(2, '0');
  const minutes = String(minute % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function compareIntervals(a: WorkingInterval, b: WorkingInterval): number {
  return (
    DAY_ORDER.indexOf(a.dayOfWeek) - DAY_ORDER.indexOf(b.dayOfWeek) ||
    a.startMinute - b.startMinute
  );
}

/**
 * Інтервали тижня з DTO → хвилини, відсортовані за днем і початком. Поле
 * помилки — шлях, як у ValidationPipe: intervals.<index>.end. Без БД.
 */
export function normalizeIntervals(
  intervals: readonly WorkingHoursIntervalDto[],
): WorkingInterval[] {
  const parsed = intervals.map((interval, index) => {
    const startMinute = parseClock(interval.start);
    const endMinute = parseClock(interval.end);
    if (endMinute <= startMinute) {
      throw fieldError(`intervals.${index}.end`, WORKING_HOURS_ORDER_MESSAGE);
    }
    if (endMinute - startMinute < LESSON_MIN_DURATION_MIN) {
      throw fieldError(`intervals.${index}.end`, WORKING_HOURS_LENGTH_MESSAGE);
    }
    return { index, dayOfWeek: interval.dayOfWeek, startMinute, endMinute };
  });

  const sorted = [...parsed].sort(compareIntervals);
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    // Напіввідкриті інтервали: 09:00–13:00 і 13:00–18:00 не перетинаються.
    if (
      current.dayOfWeek === previous.dayOfWeek &&
      current.startMinute < previous.endMinute
    ) {
      throw fieldError(
        `intervals.${Math.max(previous.index, current.index)}`,
        WORKING_HOURS_OVERLAP_MESSAGE,
      );
    }
  }
  return sorted.map(({ dayOfWeek, startMinute, endMinute }) => ({
    dayOfWeek,
    startMinute,
    endMinute,
  }));
}

/**
 * Форма тіла недоступності: рівно одна з двох, межі в правильному порядку,
 * не довше TIME_OFF_MAX_DAYS. Без БД: пояс автошколи ще не потрібен.
 */
export function assertTimeOffShape(payload: CreateTimeOffDto): void {
  const byDates =
    payload.startDate !== undefined || payload.endDate !== undefined;
  const byInstants =
    payload.startsAt !== undefined || payload.endsAt !== undefined;
  if (byDates === byInstants) {
    throw fieldError('body', TIME_OFF_FORM_MESSAGE);
  }

  if (byDates) {
    if (payload.startDate === undefined) {
      throw fieldError('startDate', REQUIRED_FIELD_MESSAGE);
    }
    const endDate = payload.endDate ?? payload.startDate;
    // YYYY-MM-DD порівнюються як рядки.
    if (endDate < payload.startDate) {
      throw fieldError('endDate', TIME_OFF_DATE_ORDER_MESSAGE);
    }
    const days =
      (Date.parse(endDate) - Date.parse(payload.startDate)) / DAY_MS + 1;
    if (days > TIME_OFF_MAX_DAYS) {
      throw fieldError('endDate', TIME_OFF_LENGTH_MESSAGE);
    }
    return;
  }

  if (payload.startsAt === undefined) {
    throw fieldError('startsAt', REQUIRED_FIELD_MESSAGE);
  }
  if (payload.endsAt === undefined) {
    throw fieldError('endsAt', REQUIRED_FIELD_MESSAGE);
  }
  const start = Date.parse(payload.startsAt);
  const end = Date.parse(payload.endsAt);
  if (end <= start) {
    throw fieldError('endsAt', TIME_OFF_INSTANT_ORDER_MESSAGE);
  }
  if (end - start > TIME_OFF_MAX_DAYS * DAY_MS) {
    throw fieldError('endsAt', TIME_OFF_LENGTH_MESSAGE);
  }
}

/**
 * Межі недоступності як моменти. Цілі дні — від місцевої півночі першого дня
 * до місцевої півночі після останнього. Форму вже перевірив assertTimeOffShape.
 */
export function resolveTimeOffInterval(
  payload: CreateTimeOffDto,
  timeZone: string,
): ScheduleSlot {
  if (payload.startDate !== undefined) {
    const endDate = payload.endDate ?? payload.startDate;
    return {
      start: startOfLocalDay(payload.startDate, timeZone),
      end: startOfLocalDay(addDays(endDate, 1), timeZone),
    };
  }
  return { start: new Date(payload.startsAt), end: new Date(payload.endsAt) };
}

function assertRole(actor: User, roles: readonly UserRole[]): void {
  if (!roles.includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

/** INSTRUCTOR бачить лише власний графік і недоступність. */
function assertVisible(actor: User, instructorId: string): void {
  if (actor.role === UserRole.INSTRUCTOR && actor.id !== instructorId) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function toWorkingHoursDto(
  instructorId: string,
  timezone: string,
  rows: readonly WorkingInterval[],
): WorkingHoursDto {
  return {
    instructorId,
    timezone,
    intervals: [...rows].sort(compareIntervals).map((row) => ({
      dayOfWeek: row.dayOfWeek,
      start: formatClock(row.startMinute),
      end: formatClock(row.endMinute),
    })),
  };
}

function toTimeOffDto(row: TimeOffRow): TimeOffDto {
  return { ...row };
}

/**
 * Робочий графік і недоступність інструктора. Обидва змінюються під
 * advisory-ключем instructor:<id> — тим самим, що бере створення й зміна
 * практичних занять, тож заняття не проскочить між перевіркою і записом.
 * Порядок помилок, як у PracticeLessonsService: 403 і 400 — до БД, потім 404, 409.
 */
@Injectable()
export class InstructorScheduleService {
  private readonly logger = new Logger(InstructorScheduleService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getWorkingHours(
    actor: User,
    instructorId: string,
  ): Promise<WorkingHoursDto> {
    assertRole(actor, SCHEDULE_VIEW_ROLES);
    assertVisible(actor, instructorId);
    const organization = await this.requireOrganization(actor.organizationId);
    await this.requireInstructorMember(actor.organizationId, instructorId);

    const rows = await this.prisma.instructorWorkingHours.findMany({
      where: { organizationId: actor.organizationId, instructorId },
      select: { dayOfWeek: true, startMinute: true, endMinute: true },
    });
    return toWorkingHoursDto(instructorId, organization.timezone, rows);
  }

  /**
   * Замінює тиждень цілком: видалення й створення в одній транзакції.
   * Заброньовані заняття не змінюються, навіть якщо випадають з нового графіка.
   */
  async replaceWorkingHours(
    actor: User,
    instructorId: string,
    payload: ReplaceWorkingHoursDto,
  ): Promise<WorkingHoursDto> {
    assertRole(actor, SCHEDULE_MANAGE_ROLES);
    const intervals = normalizeIntervals(payload.intervals);
    const organization = await this.requireOrganization(actor.organizationId);

    await this.prisma.$transaction(async (tx) => {
      await lockScheduleResources(tx, [
        scheduleLockKey('instructor', instructorId),
      ]);
      await requireInstructor(tx, actor.organizationId, instructorId);
      await tx.instructorWorkingHours.deleteMany({
        where: { organizationId: actor.organizationId, instructorId },
      });
      if (intervals.length > 0) {
        await tx.instructorWorkingHours.createMany({
          data: intervals.map((interval) => ({
            organizationId: actor.organizationId,
            instructorId,
            ...interval,
          })),
        });
      }
    });

    this.logger.log(
      `Working hours replaced instructorId=${instructorId} intervals=${intervals.length} actorId=${actor.id} organizationId=${actor.organizationId}`,
    );
    return toWorkingHoursDto(instructorId, organization.timezone, intervals);
  }

  /** Недоступності, що перетинають вікно [from, to). Без транзакції: це читання. */
  async listTimeOff(
    actor: User,
    instructorId: string,
    query: TimeOffListQueryDto,
  ): Promise<TimeOffListDto> {
    assertRole(actor, SCHEDULE_VIEW_ROLES);
    assertVisible(actor, instructorId);
    const range = resolveRange(query, new Date());
    const organization = await this.requireOrganization(actor.organizationId);
    await this.requireInstructorMember(actor.organizationId, instructorId);

    const rows = await this.prisma.instructorTimeOff.findMany({
      where: {
        organizationId: actor.organizationId,
        instructorId,
        startsAt: { lt: range.end },
        endsAt: { gt: range.start },
      },
      select: timeOffSelect,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });
    return {
      from: range.start,
      to: range.end,
      timezone: organization.timezone,
      items: rows.map(toTimeOffDto),
    };
  }

  /**
   * Нова недоступність. SCHEDULED-практика інструктора в цей час — 409 з
   * conflicts: адмін спершу скасовує чи переносить ці заняття.
   */
  async createTimeOff(
    actor: User,
    instructorId: string,
    payload: CreateTimeOffDto,
  ): Promise<TimeOffDto> {
    assertRole(actor, SCHEDULE_MANAGE_ROLES);
    assertTimeOffShape(payload);
    const organization = await this.requireOrganization(actor.organizationId);
    const interval = resolveTimeOffInterval(payload, organization.timezone);
    if (interval.end.getTime() <= Date.now()) {
      throw fieldError(
        payload.startDate !== undefined ? 'endDate' : 'endsAt',
        TIME_OFF_IN_PAST_MESSAGE,
      );
    }

    const saved = await this.prisma.$transaction(async (tx) => {
      await lockScheduleResources(tx, [
        scheduleLockKey('instructor', instructorId),
      ]);
      await requireInstructor(tx, actor.organizationId, instructorId);

      const conflicts = await findTimeOffConflicts(tx, {
        organizationId: actor.organizationId,
        instructorId,
        interval,
      });
      if (conflicts.length > 0) {
        this.logger.log(
          `Time off conflict instructorId=${instructorId} conflicts=${conflicts.length} actorId=${actor.id} organizationId=${actor.organizationId}`,
        );
        throw scheduleConflict(conflicts);
      }

      return tx.instructorTimeOff.create({
        data: {
          organizationId: actor.organizationId,
          instructorId,
          startsAt: interval.start,
          endsAt: interval.end,
          type: payload.type,
          reason: payload.reason,
          createdById: actor.id,
        },
        select: timeOffSelect,
      });
    });

    this.logger.log(
      `Time off created timeOffId=${saved.id} instructorId=${instructorId} type=${saved.type} startsAt=${saved.startsAt.toISOString()} endsAt=${saved.endsAt.toISOString()} actorId=${actor.id} organizationId=${actor.organizationId}`,
    );
    return toTimeOffDto(saved);
  }

  /** Видалення лише звільняє час, тож advisory-ключ не потрібен. */
  async removeTimeOff(
    actor: User,
    instructorId: string,
    timeOffId: string,
  ): Promise<void> {
    assertRole(actor, SCHEDULE_MANAGE_ROLES);
    await this.requireOrganization(actor.organizationId);

    const { count } = await this.prisma.instructorTimeOff.deleteMany({
      where: {
        id: timeOffId,
        instructorId,
        organizationId: actor.organizationId,
      },
    });
    if (count === 0) {
      throw new NotFoundException(TIME_OFF_NOT_FOUND_MESSAGE);
    }

    this.logger.log(
      `Time off deleted timeOffId=${timeOffId} instructorId=${instructorId} actorId=${actor.id} organizationId=${actor.organizationId}`,
    );
  }

  /**
   * Для читання: інструктор цієї автошколи, не видалений. Статус не важить —
   * графік заблокованого інструктора теж можна переглянути.
   */
  private async requireInstructorMember(
    organizationId: string,
    instructorId: string,
  ): Promise<void> {
    const instructor = await this.prisma.user.findFirst({
      where: {
        id: instructorId,
        organizationId,
        role: UserRole.INSTRUCTOR,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!instructor) {
      throw new NotFoundException(INSTRUCTOR_NOT_FOUND_MESSAGE);
    }
  }

  private async requireOrganization(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization || organization.deletedAt) {
      throw new NotFoundException('Organization not found');
    }
    return organization;
  }
}
