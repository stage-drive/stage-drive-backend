import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CarStatus, Prisma, User, UserRole, UserStatus } from '@prisma/client';
import {
  lockPracticeSlot,
  lockScheduleResources,
  scheduleLockKey,
} from '../../common/prisma/schedule-lock';
import { PrismaService } from '../../prisma/prisma.service';
import { STUDENT_NOT_FOUND_MESSAGE } from '../students/students.service';
import { PRACTICE_DEFAULT_DURATION_MIN } from './lessons.dto';
import {
  practiceStudentSelect,
  requireInstructor,
  requirePracticeProfile,
  requireSlotCar,
} from './practice-rules';
import {
  practiceSlotViewSelect,
  toPracticeSlotDto,
} from './practice-slot-view';
import {
  AvailablePracticeSlotQueryDto,
  CreatePracticeSlotDto,
  PracticeSlotDto,
  PracticeSlotListDto,
  PracticeSlotListQueryDto,
  UpdatePracticeSlotDto,
} from './practice-slots.dto';
import {
  ScheduleSlot,
  candidateWindow,
  findSlotConflicts,
  findStudentSlotBlockers,
  isSlotFree,
  lessonSlot,
  overlaps,
  scheduleConflict,
  spanOf,
} from './schedule-conflicts';
import { fieldError, resolveRange } from './schedule-range';

export const PRACTICE_SLOT_MANAGE_ROLES = [UserRole.ADMIN] as const;
export const PRACTICE_SLOT_VIEW_ROLES = [
  UserRole.ADMIN,
  UserRole.INSTRUCTOR,
] as const;
export const PRACTICE_SLOT_AVAILABLE_ROLES = [UserRole.STUDENT] as const;

export const SLOT_NOT_FOUND_MESSAGE = 'Practice slot not found';
export const SLOT_IN_PAST_MESSAGE =
  'Слот можна створити чи перенести лише на майбутній час.';
export const SLOT_START_MINUTE_MESSAGE =
  'Слот має починатися на початку хвилини (секунди 00).';
export const SLOT_ALREADY_STARTED_MESSAGE =
  'Слот уже почався: змінити чи видалити його не можна.';
export const NO_SLOT_FIELDS_MESSAGE =
  'Немає полів для оновлення (instructorId, carId, scheduledAt, durationMin).';
export const PRACTICE_PROFILE_INCOMPLETE_MESSAGE =
  'Профіль практики не завершено: немає інструктора, категорії чи коробки передач. Зверніться до адміністратора автошколи.';

const MINUTE_MS = 60_000;

/** Надмножина practiceSlotViewSelect: id інструктора й авто потрібні зміні та RBAC. */
const practiceSlotSelect = {
  ...practiceSlotViewSelect,
  instructorId: true,
  carId: true,
} satisfies Prisma.PracticeSlotSelect;

type SlotChange = {
  instructorId?: string;
  carId?: string;
  scheduledAt?: Date;
  durationMin?: number;
};

function assertRole(actor: User, roles: readonly UserRole[]): void {
  if (!roles.includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function isEmptyPayload(payload: object): boolean {
  return Object.values(payload).every((value) => value === undefined);
}

/**
 * Початок слоту — у майбутньому і на цілій хвилині. Ціла хвилина потрібна, щоб
 * PR робочого графіка порівнював слот з інтервалами HH:MM без округлення.
 * Перевірка не потребує БД.
 */
function assertSlotStart(scheduledAt: Date, now: Date): void {
  if (scheduledAt.getTime() <= now.getTime()) {
    throw fieldError('scheduledAt', SLOT_IN_PAST_MESSAGE);
  }
  if (scheduledAt.getTime() % MINUTE_MS !== 0) {
    throw fieldError('scheduledAt', SLOT_START_MINUTE_MESSAGE);
  }
}

/** Межа та сама, що в занятті: scheduledAt = now — уже почався. */
function assertNotStarted(scheduledAt: Date, now: Date): void {
  if (scheduledAt.getTime() <= now.getTime()) {
    throw new ConflictException(SLOT_ALREADY_STARTED_MESSAGE);
  }
}

@Injectable()
export class PracticeSlotsService {
  private readonly logger = new Logger(PracticeSlotsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Новий слот. Рядка ще немає, тож row-lock не береться: лише advisory-ключі. */
  async create(
    actor: User,
    payload: CreatePracticeSlotDto,
  ): Promise<PracticeSlotDto> {
    assertRole(actor, PRACTICE_SLOT_MANAGE_ROLES);
    const scheduledAt = new Date(payload.scheduledAt);
    const durationMin = payload.durationMin ?? PRACTICE_DEFAULT_DURATION_MIN;
    assertSlotStart(scheduledAt, new Date());
    await this.requireOrganization(actor.organizationId);

    const saved = await this.prisma.$transaction(async (tx) => {
      await this.assertSlotValid(tx, actor, {
        slotId: null,
        instructorId: payload.instructorId,
        carId: payload.carId,
        interval: lessonSlot(scheduledAt, durationMin),
      });
      return tx.practiceSlot.create({
        data: {
          organizationId: actor.organizationId,
          instructorId: payload.instructorId,
          carId: payload.carId,
          scheduledAt,
          durationMin,
          createdById: actor.id,
        },
        select: practiceSlotViewSelect,
      });
    });

    this.logger.log(
      `Practice slot created slotId=${saved.id} instructorId=${saved.instructor.id} carId=${saved.car.id} scheduledAt=${saved.scheduledAt.toISOString()} durationMin=${saved.durationMin} actorId=${actor.id} organizationId=${actor.organizationId}`,
    );
    return toPracticeSlotDto(saved);
  }

  /**
   * Порядок блокувань: слот (FOR UPDATE) → advisory-ключі. Нові значення
   * зливаються з поточними і проходять ті самі перевірки, що й новий слот.
   */
  async update(
    actor: User,
    slotId: string,
    payload: UpdatePracticeSlotDto,
  ): Promise<PracticeSlotDto> {
    assertRole(actor, PRACTICE_SLOT_MANAGE_ROLES);
    if (isEmptyPayload(payload)) {
      throw fieldError('body', NO_SLOT_FIELDS_MESSAGE);
    }
    const now = new Date();
    const requestedStart =
      payload.scheduledAt === undefined
        ? undefined
        : new Date(payload.scheduledAt);
    if (requestedStart) {
      assertSlotStart(requestedStart, now);
    }
    await this.requireOrganization(actor.organizationId);

    const result = await this.prisma.$transaction(async (tx) => {
      const slot = await this.lockSlot(tx, actor, slotId);
      assertNotStarted(slot.scheduledAt, now);

      const next = {
        instructorId: payload.instructorId ?? slot.instructorId,
        carId: payload.carId ?? slot.carId,
        scheduledAt: requestedStart ?? slot.scheduledAt,
        durationMin: payload.durationMin ?? slot.durationMin,
      };
      const data: SlotChange = {};
      if (next.instructorId !== slot.instructorId) {
        data.instructorId = next.instructorId;
      }
      if (next.carId !== slot.carId) {
        data.carId = next.carId;
      }
      if (next.scheduledAt.getTime() !== slot.scheduledAt.getTime()) {
        data.scheduledAt = next.scheduledAt;
      }
      if (next.durationMin !== slot.durationMin) {
        data.durationMin = next.durationMin;
      }
      if (Object.keys(data).length === 0) {
        return { slot, changed: [] as string[] };
      }

      await this.assertSlotValid(tx, actor, {
        slotId: slot.id,
        instructorId: next.instructorId,
        carId: next.carId,
        interval: lessonSlot(next.scheduledAt, next.durationMin),
      });
      const saved = await tx.practiceSlot.update({
        where: { id: slot.id },
        data,
        select: practiceSlotSelect,
      });
      return { slot: saved, changed: Object.keys(data) };
    });

    if (result.changed.length > 0) {
      this.logger.log(
        `Practice slot updated slotId=${result.slot.id} fields=${result.changed.join(',')} scheduledAt=${result.slot.scheduledAt.toISOString()} actorId=${actor.id} organizationId=${actor.organizationId}`,
      );
    }
    return toPracticeSlotDto(result.slot);
  }

  /**
   * Видалення фізичне: бронювань ще немає, тож слот не має історії. Слот, що
   * вже почався, лишається.
   */
  async remove(actor: User, slotId: string): Promise<void> {
    assertRole(actor, PRACTICE_SLOT_MANAGE_ROLES);
    await this.requireOrganization(actor.organizationId);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const slot = await this.lockSlot(tx, actor, slotId);
      assertNotStarted(slot.scheduledAt, now);
      await tx.practiceSlot.delete({ where: { id: slot.id } });
    });

    this.logger.log(
      `Practice slot deleted slotId=${slotId} actorId=${actor.id} organizationId=${actor.organizationId}`,
    );
  }

  /**
   * Слоти, що перетинають вікно [from, to). INSTRUCTOR бачить лише свої. Без
   * транзакції: це читання. Як у PersonalScheduleService: 403 і 400 — до
   * запитів у БД, потім 404.
   */
  async list(
    actor: User,
    query: PracticeSlotListQueryDto,
  ): Promise<PracticeSlotListDto> {
    assertRole(actor, PRACTICE_SLOT_VIEW_ROLES);
    const instructorId = this.visibleInstructor(actor, query.instructorId);
    const range = resolveRange(query, new Date());
    const organization = await this.requireOrganization(actor.organizationId);

    const filters: Prisma.PracticeSlotWhereInput[] = [
      { organizationId: actor.organizationId },
      { scheduledAt: candidateWindow(range) },
    ];
    if (instructorId) {
      filters.push({ instructorId });
    }
    if (query.carId) {
      filters.push({ carId: query.carId });
    }

    // БД повертає кандидатів, що починаються у вікні candidateWindow;
    // точний перетин рахує overlaps, як у персональному розкладі.
    const rows = await this.prisma.practiceSlot.findMany({
      where: { AND: filters },
      select: practiceSlotViewSelect,
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
    });

    return {
      from: range.start,
      to: range.end,
      timezone: organization.timezone,
      items: rows.filter((row) => overlaps(range, row)).map(toPracticeSlotDto),
    };
  }

  /**
   * Слоти, на які студент може записатися: починаються у вікні [from, to) і в
   * майбутньому, інструктор студента ACTIVE, авто AVAILABLE і підходить
   * студенту, час не зайнятий інструктором, авто чи самим студентом. Без
   * транзакції: це знімок, бронювання перевірить усе ще раз під ключами.
   * Як у list: 403 і 400 — до запитів у БД, потім 404, потім 409.
   */
  async listAvailable(
    actor: User,
    query: AvailablePracticeSlotQueryDto,
  ): Promise<PracticeSlotListDto> {
    assertRole(actor, PRACTICE_SLOT_AVAILABLE_ROLES);
    const now = new Date();
    const range = resolveRange(query, now);
    const organization = await this.requireOrganization(actor.organizationId);
    const profile = await this.requireBookingProfile(actor);

    // Статуси інструктора й авто — на момент запиту: після створення слоту
    // інструктора могли заблокувати, авто — перевести в MAINTENANCE чи
    // переприв'язати. gt: now ховає слоти, що вже почалися, навіть коли from
    // у минулому.
    const slots = await this.prisma.practiceSlot.findMany({
      where: {
        organizationId: actor.organizationId,
        instructorId: profile.instructorId,
        scheduledAt: { gt: now, gte: range.start, lt: range.end },
        instructor: {
          is: {
            role: UserRole.INSTRUCTOR,
            status: UserStatus.ACTIVE,
            deletedAt: null,
          },
        },
        car: {
          is: {
            status: CarStatus.AVAILABLE,
            instructorId: profile.instructorId,
            category: profile.category,
            transmission: profile.transmission,
          },
        },
      },
      select: practiceSlotSelect,
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
    });

    // Зайнятість одним набором запитів на всі слоти, а не запитом на слот.
    const blockers =
      slots.length === 0
        ? []
        : await findStudentSlotBlockers(this.prisma, {
            organizationId: actor.organizationId,
            studentId: actor.id,
            instructorId: profile.instructorId,
            carIds: [...new Set(slots.map((slot) => slot.carId))],
            interval: spanOf(slots),
          });

    return {
      from: range.start,
      to: range.end,
      timezone: organization.timezone,
      items: slots
        .filter((slot) => isSlotFree(slot, blockers, actor.id))
        .map(toPracticeSlotDto),
    };
  }

  /** Слот іншої організації — 404, чужий слот для INSTRUCTOR — 403. */
  async findOne(actor: User, slotId: string): Promise<PracticeSlotDto> {
    assertRole(actor, PRACTICE_SLOT_VIEW_ROLES);
    await this.requireOrganization(actor.organizationId);

    const slot = await this.prisma.practiceSlot.findFirst({
      where: { id: slotId, organizationId: actor.organizationId },
      select: practiceSlotSelect,
    });
    if (!slot) {
      throw new NotFoundException(SLOT_NOT_FOUND_MESSAGE);
    }
    if (actor.role === UserRole.INSTRUCTOR && slot.instructorId !== actor.id) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return toPracticeSlotDto(slot);
  }

  /**
   * Advisory-ключі інструктора й авто → інструктор → авто → конфлікти. Ключі
   * беруться першими: створення й зміна практичних занять беруть ті самі, тож
   * паралельне заняття не проскочить між перевіркою і записом слоту.
   */
  private async assertSlotValid(
    tx: Prisma.TransactionClient,
    actor: User,
    input: {
      slotId: string | null;
      instructorId: string;
      carId: string;
      interval: ScheduleSlot;
    },
  ): Promise<void> {
    await lockScheduleResources(tx, [
      scheduleLockKey('instructor', input.instructorId),
      scheduleLockKey('car', input.carId),
    ]);
    await requireInstructor(tx, actor.organizationId, input.instructorId);
    await requireSlotCar(
      tx,
      actor.organizationId,
      input.carId,
      input.instructorId,
    );

    const conflicts = await findSlotConflicts(tx, {
      organizationId: actor.organizationId,
      ...input,
    });
    if (conflicts.length > 0) {
      this.logger.log(
        `Practice slot conflict slotId=${input.slotId ?? 'new'} conflicts=${conflicts.length} actorId=${actor.id} organizationId=${actor.organizationId}`,
      );
      throw scheduleConflict(conflicts);
    }
  }

  /**
   * Блокує слот (FOR UPDATE) і читає його. Паралельна зміна чи видалення того
   * самого слоту чекає на цю транзакцію. Слот іншої організації — 404.
   */
  private async lockSlot(
    tx: Prisma.TransactionClient,
    actor: User,
    slotId: string,
  ) {
    await lockPracticeSlot(tx, slotId, actor.organizationId);
    const slot = await tx.practiceSlot.findFirst({
      where: { id: slotId, organizationId: actor.organizationId },
      select: practiceSlotSelect,
    });
    if (!slot) {
      throw new NotFoundException(SLOT_NOT_FOUND_MESSAGE);
    }
    return slot;
  }

  /** INSTRUCTOR бачить лише свої слоти; чужий instructorId — 403. */
  private visibleInstructor(
    actor: User,
    requested: string | undefined,
  ): string | undefined {
    if (actor.role !== UserRole.INSTRUCTOR) {
      return requested;
    }
    if (requested !== undefined && requested !== actor.id) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return actor.id;
  }

  /**
   * Студент з токена з допуском PRACTICE і повним профілем практики.
   * Бронювання викликатиме те саме. Без категорії чи коробки авто не
   * підібрати, без інструктора — слоти.
   */
  private async requireBookingProfile(actor: User) {
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
    const { instructorId, category, transmission } =
      requirePracticeProfile(student);
    if (!instructorId || !category || !transmission) {
      throw new ConflictException(PRACTICE_PROFILE_INCOMPLETE_MESSAGE);
    }
    return { instructorId, category, transmission };
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
