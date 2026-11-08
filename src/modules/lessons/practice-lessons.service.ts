import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CarStatus,
  LessonStatus,
  LicenseCategory,
  Prisma,
  Transmission,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { STUDENT_NOT_FOUND_MESSAGE } from '../students/students.service';
import {
  PRACTICE_BOOKING_DURATION_MIN,
  computeAvailableSlots,
  isSlotStart,
} from './availability';
import {
  practiceLessonViewSelect,
  toPerson,
  toPracticeLessonDto,
} from './lesson-view';
import { LESSON_MAX_DURATION_MIN, PracticeLessonDto } from './lessons.dto';
import {
  lockPracticeResources,
  practiceStudentSelect,
  requireInstructor,
  requirePracticeCar,
  requirePracticeProfile,
} from './practice-rules';
import {
  ActivePracticeLessonDto,
  AvailablePracticeSlotListDto,
  AvailablePracticeSlotQueryDto,
  BookPracticeLessonDto,
  PracticeLessonListDto,
  PracticeLessonListQueryDto,
} from './practice-lessons.dto';
import {
  ScheduleSlot,
  candidateWindow,
  findPracticeConflicts,
  findStudentSlotBlockers,
  lessonEnd,
  lessonSlot,
  overlaps,
  scheduleConflict,
} from './schedule-conflicts';
import { fieldError, resolveRange } from './schedule-range';

export const PRACTICE_LESSON_LIST_ROLES = [UserRole.ADMIN] as const;
export const PRACTICE_BOOKING_ROLES = [UserRole.STUDENT] as const;

export const PRACTICE_PROFILE_INCOMPLETE_MESSAGE =
  'Профіль практики не завершено: немає інструктора, авто, категорії чи коробки передач. Зверніться до адміністратора автошколи.';
export const STUDENT_HAS_ACTIVE_LESSON_MESSAGE =
  'У вас уже є заплановане практичне заняття. Нове можна забронювати, коли воно закінчиться, або скасувавши його.';
export const SLOT_NOT_OPEN_MESSAGE =
  'Цей час не відкритий для запису: він поза робочим графіком інструктора.';
export const BOOKING_IN_PAST_MESSAGE = 'Забронювати можна лише майбутній час.';

const MINUTE_MS = 60_000;

type BookingProfile = {
  instructorId: string;
  carId: string;
  category: LicenseCategory;
  transmission: Transmission;
};

function assertRole(actor: User, roles: readonly UserRole[]): void {
  if (!roles.includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

/**
 * Заплановане практичне заняття студента, що ще не закінчилося (майбутнє чи
 * таке, що триває). Минулі заняття часто лишаються SCHEDULED, тож рахується
 * кінець заняття, а не статус. Prisma не фільтрує за scheduledAt +
 * durationMin, тому БД повертає кандидатів за верхньою межею тривалості.
 */
async function findActiveLesson(
  client: Prisma.TransactionClient,
  actor: User,
  now: Date,
): Promise<{ id: string; scheduledAt: Date; durationMin: number } | null> {
  const rows = await client.drivingLesson.findMany({
    where: {
      organizationId: actor.organizationId,
      studentId: actor.id,
      status: LessonStatus.SCHEDULED,
      scheduledAt: {
        gt: new Date(now.getTime() - LESSON_MAX_DURATION_MIN * MINUTE_MS),
      },
    },
    select: { id: true, scheduledAt: true, durationMin: true },
    orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
  });
  return (
    rows.find(
      (row) =>
        lessonEnd(row.scheduledAt, row.durationMin).getTime() > now.getTime(),
    ) ?? null
  );
}

function toActiveLessonDto(row: {
  id: string;
  scheduledAt: Date;
  durationMin: number;
}): ActivePracticeLessonDto {
  return {
    id: row.id,
    scheduledAt: row.scheduledAt,
    endsAt: lessonEnd(row.scheduledAt, row.durationMin),
  };
}

/**
 * Практичні заняття з боку студента — вільні слоти й бронювання — і список
 * занять автошколи для ADMIN. Слоти не зберігаються: їх рахує
 * computeAvailableSlots з робочого графіка інструктора, його недоступності й
 * уже запланованих занять. Бронювання створює DrivingLesson під тими самими
 * advisory-ключами й перевірками, що й LessonsService.createPractice.
 * Порядок помилок: 403 і 400 — до запитів у БД, потім 404, потім 409.
 */
@Injectable()
export class PracticeLessonsService {
  private readonly logger = new Logger(PracticeLessonsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Заняття автошколи, що перетинають вікно [from, to). Без транзакції: це читання. */
  async list(
    actor: User,
    query: PracticeLessonListQueryDto,
  ): Promise<PracticeLessonListDto> {
    assertRole(actor, PRACTICE_LESSON_LIST_ROLES);
    const range = resolveRange(query, new Date());
    const organization = await this.requireOrganization(actor.organizationId);

    const filters: Prisma.DrivingLessonWhereInput[] = [
      { organizationId: actor.organizationId },
      { scheduledAt: candidateWindow(range) },
    ];
    if (!query.includeCancelled) {
      filters.push({ status: { not: LessonStatus.CANCELLED } });
    }
    if (query.instructorId) {
      filters.push({ instructorId: query.instructorId });
    }
    if (query.studentId) {
      filters.push({ studentId: query.studentId });
    }

    // БД повертає кандидатів, що починаються у вікні candidateWindow;
    // точний перетин рахує overlaps, як у персональному розкладі.
    const rows = await this.prisma.drivingLesson.findMany({
      where: { AND: filters },
      select: practiceLessonViewSelect,
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
    });
    return {
      from: range.start,
      to: range.end,
      timezone: organization.timezone,
      items: rows
        .filter((row) => overlaps(range, row))
        .map(toPracticeLessonDto),
    };
  }

  /**
   * Вільні слоти інструктора студента на авто студента, що починаються у вікні
   * [from, to) і в майбутньому. Інструктор не ACTIVE чи авто непридатне —
   * порожній список. Без транзакції: це знімок, бронювання перевірить усе ще
   * раз під ключами.
   */
  async listAvailable(
    actor: User,
    query: AvailablePracticeSlotQueryDto,
  ): Promise<AvailablePracticeSlotListDto> {
    assertRole(actor, PRACTICE_BOOKING_ROLES);
    const now = new Date();
    const range = resolveRange(query, now);
    const organization = await this.requireOrganization(actor.organizationId);
    const profile = await this.requireBookingProfile(actor);
    const activeLesson = await findActiveLesson(this.prisma, actor, now);
    const durationMin = PRACTICE_BOOKING_DURATION_MIN;

    const base = {
      from: range.start,
      to: range.end,
      timezone: organization.timezone,
      durationMin,
      activeLesson: activeLesson ? toActiveLessonDto(activeLesson) : null,
    };

    const resources = await this.findUsableResources(actor, profile);
    if (!resources) {
      return { ...base, items: [] };
    }

    // Слот, що починається до range.end, закінчується до range.end + durationMin:
    // зайнятість і недоступність беруться з цим запасом.
    const span: ScheduleSlot = {
      start: range.start,
      end: new Date(range.end.getTime() + durationMin * MINUTE_MS),
    };
    const [workingHours, timeOffs, blockers] = await Promise.all([
      this.prisma.instructorWorkingHours.findMany({
        where: {
          organizationId: actor.organizationId,
          instructorId: profile.instructorId,
        },
        select: { dayOfWeek: true, startMinute: true, endMinute: true },
      }),
      this.prisma.instructorTimeOff.findMany({
        where: {
          organizationId: actor.organizationId,
          instructorId: profile.instructorId,
          startsAt: { lt: span.end },
          endsAt: { gt: span.start },
        },
        select: { startsAt: true, endsAt: true },
      }),
      findStudentSlotBlockers(this.prisma, {
        organizationId: actor.organizationId,
        studentId: actor.id,
        instructorId: profile.instructorId,
        carIds: [profile.carId],
        interval: span,
      }),
    ]);

    const starts = computeAvailableSlots({
      range,
      timeZone: organization.timezone,
      now,
      durationMin,
      workingHours,
      timeOffs,
      blockers,
      instructorId: profile.instructorId,
      carId: profile.carId,
      studentId: actor.id,
    });

    return {
      ...base,
      items: starts.map((scheduledAt) => ({
        scheduledAt,
        endsAt: lessonEnd(scheduledAt, durationMin),
        durationMin,
        instructor: toPerson(resources.instructor),
        car: resources.car,
      })),
    };
  }

  /**
   * Бронювання слоту студентом. Порядок: advisory-ключі (ті самі, що в
   * createPractice) → одне активне заняття → інструктор → авто → час у сітці
   * робочого графіка → конфлікти (заняття, теорія, недоступність) → запис.
   */
  async book(
    actor: User,
    payload: BookPracticeLessonDto,
  ): Promise<PracticeLessonDto> {
    assertRole(actor, PRACTICE_BOOKING_ROLES);
    const now = new Date();
    const scheduledAt = new Date(payload.scheduledAt);
    if (scheduledAt.getTime() <= now.getTime()) {
      throw fieldError('scheduledAt', BOOKING_IN_PAST_MESSAGE);
    }
    const organization = await this.requireOrganization(actor.organizationId);
    const profile = await this.requireBookingProfile(actor);
    const durationMin = PRACTICE_BOOKING_DURATION_MIN;
    const slot = lessonSlot(scheduledAt, durationMin);

    const saved = await this.prisma.$transaction(async (tx) => {
      await lockPracticeResources(tx, {
        instructorId: profile.instructorId,
        carId: profile.carId,
        studentId: actor.id,
      });

      if (await findActiveLesson(tx, actor, now)) {
        throw new ConflictException(STUDENT_HAS_ACTIVE_LESSON_MESSAGE);
      }
      await requireInstructor(tx, actor.organizationId, profile.instructorId);
      await requirePracticeCar(tx, actor.organizationId, profile.carId, {
        instructorId: profile.instructorId,
        category: profile.category,
        transmission: profile.transmission,
      });

      const workingHours = await tx.instructorWorkingHours.findMany({
        where: {
          organizationId: actor.organizationId,
          instructorId: profile.instructorId,
        },
        select: { dayOfWeek: true, startMinute: true, endMinute: true },
      });
      if (
        !isSlotStart({
          scheduledAt,
          timeZone: organization.timezone,
          durationMin,
          workingHours,
        })
      ) {
        throw new ConflictException(SLOT_NOT_OPEN_MESSAGE);
      }

      const conflicts = await findPracticeConflicts(tx, {
        organizationId: actor.organizationId,
        lessonId: null,
        instructorId: profile.instructorId,
        carId: profile.carId,
        studentId: actor.id,
        slot,
      });
      if (conflicts.length > 0) {
        this.logger.log(
          `Practice booking conflict studentId=${actor.id} scheduledAt=${scheduledAt.toISOString()} conflicts=${conflicts.length} organizationId=${actor.organizationId}`,
        );
        throw scheduleConflict(conflicts);
      }

      return tx.drivingLesson.create({
        data: {
          organizationId: actor.organizationId,
          instructorId: profile.instructorId,
          studentId: actor.id,
          carId: profile.carId,
          scheduledAt,
          durationMin,
          meetingPlace: payload.meetingPlace ?? null,
        },
        select: practiceLessonViewSelect,
      });
    });

    this.logger.log(
      `Practice lesson booked lessonId=${saved.id} studentId=${actor.id} instructorId=${profile.instructorId} carId=${profile.carId} scheduledAt=${saved.scheduledAt.toISOString()} durationMin=${saved.durationMin} organizationId=${actor.organizationId}`,
    );
    return toPracticeLessonDto(saved);
  }

  /**
   * Студент з токена з допуском PRACTICE і повним профілем практики: без
   * інструктора немає графіка, без авто, категорії й коробки — на чому їздити.
   */
  private async requireBookingProfile(actor: User): Promise<BookingProfile> {
    const student = await this.prisma.user.findFirst({
      where: {
        id: actor.id,
        organizationId: actor.organizationId,
        role: UserRole.STUDENT,
        deletedAt: null,
        studentProfile: { is: { organizationId: actor.organizationId } },
      },
      select: practiceStudentSelect,
    });
    if (!student) {
      throw new NotFoundException(STUDENT_NOT_FOUND_MESSAGE);
    }
    const { instructorId, carId, category, transmission } =
      requirePracticeProfile(student);
    if (!instructorId || !carId || !category || !transmission) {
      throw new ConflictException(PRACTICE_PROFILE_INCOMPLETE_MESSAGE);
    }
    return { instructorId, carId, category, transmission };
  }

  /**
   * Інструктор і авто студента на момент запиту, якщо на них можна записатися:
   * інструктор ACTIVE, авто AVAILABLE, закріплене за ним і підходить студенту.
   * Ті самі правила, що requireInstructor і requirePracticeCar при бронюванні.
   */
  private async findUsableResources(actor: User, profile: BookingProfile) {
    const [instructor, car] = await Promise.all([
      this.prisma.user.findFirst({
        where: {
          id: profile.instructorId,
          organizationId: actor.organizationId,
          role: UserRole.INSTRUCTOR,
          status: UserStatus.ACTIVE,
          deletedAt: null,
        },
        select: { id: true, firstName: true, lastName: true },
      }),
      this.prisma.car.findFirst({
        where: {
          id: profile.carId,
          organizationId: actor.organizationId,
          instructorId: profile.instructorId,
          status: CarStatus.AVAILABLE,
          category: profile.category,
          transmission: profile.transmission,
        },
        select: {
          id: true,
          plateNumber: true,
          category: true,
          transmission: true,
        },
      }),
    ]);
    return instructor && car ? { instructor, car } : null;
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
