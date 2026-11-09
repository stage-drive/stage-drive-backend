import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingConfirmation,
  GroupStatus,
  LessonStatus,
  Prisma,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { lockGroup } from '../../common/prisma/group-lock';
import {
  lockScheduleResources,
  lockTheoryLesson,
  scheduleLockKey,
} from '../../common/prisma/schedule-lock';
import { localDate } from '../../common/time/zoned-time';
import { PrismaService } from '../../prisma/prisma.service';
import { GROUP_NOT_FOUND_MESSAGE } from '../groups/groups.service';
import { STUDENT_NOT_FOUND_MESSAGE } from '../students/students.service';
import {
  BOOKING_MIN_LEAD_HOURS,
  PRACTICE_BOOKING_DURATION_MIN,
  isSlotStart,
} from './availability';
import {
  lessonPersonSelect,
  practiceBookingStatus,
  toPracticeLessonDto,
  toTheoryLessonDto,
} from './lesson-view';
import {
  CancelLessonDto,
  CreatePracticeLessonDto,
  LESSON_NOT_FOUND_MESSAGE,
  CreateTheoryLessonDto,
  PRACTICE_DEFAULT_DURATION_MIN,
  PracticeLessonDto,
  RescheduleLessonDto,
  THEORY_DEFAULT_DURATION_MIN,
  TheoryLessonDto,
  UpdatePracticeLessonDto,
  UpdateTheoryLessonDto,
} from './lessons.dto';
import {
  lockPracticeLessonForChange,
  practiceLessonSelect,
} from './practice-lesson-row';
import {
  BOOKING_IN_PAST_MESSAGE,
  BOOKING_TOO_SOON_MESSAGE,
  SLOT_NOT_OPEN_MESSAGE,
} from './practice-lessons.service';
import { PracticePaymentService } from './practice-payment.service';
import {
  assertInstructorActive,
  lockPracticeResources,
  practiceStudentSelect,
  requireInstructor,
  requirePracticeCar,
  requirePracticeProfile,
} from './practice-rules';
import {
  ScheduleSlot,
  findPracticeConflicts,
  findTheoryConflicts,
  lessonSlot,
  scheduleConflict,
} from './schedule-conflicts';

export const THEORY_LESSON_EDIT_ROLES = [
  UserRole.ADMIN,
  UserRole.TEACHER,
] as const;

/** Створення й перенесення практики: розкладом керує лише ADMIN. */
export const PRACTICE_LESSON_SCHEDULE_ROLES = [UserRole.ADMIN] as const;

/**
 * Перенесення: ADMIN — будь-яке заняття (робочий графік не перевіряється);
 * STUDENT — своє бронювання на інший вільний слот за правилами бронювання.
 */
export const PRACTICE_LESSON_RESCHEDULE_ROLES = [
  UserRole.ADMIN,
  UserRole.STUDENT,
] as const;

/** Студент переносить своє заняття не пізніше ніж за стільки годин до його початку. */
export const STUDENT_RESCHEDULE_MIN_HOURS = 3;

/** Редагування: INSTRUCTOR змінює лише місце зустрічі свого заняття. */
export const PRACTICE_LESSON_EDIT_ROLES = [
  UserRole.ADMIN,
  UserRole.INSTRUCTOR,
] as const;

/** Скасування: STUDENT — лише своє заняття і не пізніше ніж за 24 години. */
export const PRACTICE_LESSON_CANCEL_ROLES = [
  UserRole.ADMIN,
  UserRole.INSTRUCTOR,
  UserRole.STUDENT,
] as const;

/** Студент скасовує своє заняття не пізніше ніж за стільки годин до початку. */
export const STUDENT_CANCEL_MIN_HOURS = 2;

/** Живе в lessons.dto.ts: його беруть і хелпери рядка практичного заняття. */
export { LESSON_NOT_FOUND_MESSAGE } from './lessons.dto';
export const LESSON_NOT_EDITABLE_MESSAGE =
  'Змінювати можна лише заняття зі статусом SCHEDULED.';
export const LESSON_GROUP_CLOSED_MESSAGE =
  'Заняття групи зі статусом COMPLETED або ARCHIVED не можна змінювати.';
export const LESSON_IN_PAST_MESSAGE =
  'Заняття можна перенести лише на майбутній час.';
export const LESSON_ALREADY_STARTED_MESSAGE =
  'Заняття вже почалося. Спершу перенесіть його на майбутній час.';
export const LESSON_OUTSIDE_GROUP_DATES_MESSAGE =
  'Дата заняття виходить за період навчання групи.';
export const LESSON_TEACHER_NOT_ACTIVE_MESSAGE =
  'Викладач групи має бути в статусі ACTIVE.';
/** Живе в practice-rules.ts: його бере й PracticeLessonsService. */
export { STUDENT_NOT_IN_PRACTICE_MESSAGE } from './practice-rules';
export const PRACTICE_CAR_REQUIRED_MESSAGE =
  'Для практичного заняття потрібен автомобіль. Передайте carId.';
export const LESSON_INSTRUCTOR_FIELDS_MESSAGE =
  'Інструктор може змінити лише місце зустрічі (meetingPlace). Решту змінює ADMIN.';
export const STUDENT_CANCEL_TOO_LATE_MESSAGE = `Скасувати підтверджене заняття можна не пізніше ніж за ${STUDENT_CANCEL_MIN_HOURS} години до початку. Зверніться до адміністратора автошколи.`;
/** Причина, коли інструктор скасовує заняття без пояснення (вимога «Не можу провести заняття»). */
export const INSTRUCTOR_CANCEL_DEFAULT_REASON = 'Не можу провести заняття';
export const STUDENT_RESCHEDULE_TOO_LATE_MESSAGE = `Перенести заняття можна не пізніше ніж за ${STUDENT_RESCHEDULE_MIN_HOURS} години до його початку.`;
export const STUDENT_RESCHEDULE_NOT_ACTIVE_MESSAGE =
  'Перенести можна лише заплановане заняття. Щоб записатися знову, забронюйте новий слот.';
export const STUDENT_DURATION_MESSAGE = 'Студент не змінює тривалість заняття.';
export const NO_THEORY_LESSON_FIELDS_MESSAGE =
  'Немає дозволених полів для оновлення (topic, durationMin).';
export const NO_PRACTICE_LESSON_FIELDS_MESSAGE =
  'Немає дозволених полів для оновлення (durationMin, instructorId, carId, meetingPlace).';
export const LESSON_NOT_CANCELLABLE_MESSAGE =
  'Скасувати можна лише заняття зі статусом SCHEDULED.';
export const LESSON_CANCEL_STARTED_MESSAGE =
  'Скасувати можна лише заняття, яке ще не почалося.';
export const LESSON_CREATE_IN_PAST_MESSAGE =
  'Заняття можна створити лише на майбутній час.';
export const LESSON_GROUP_NOT_OPEN_MESSAGE =
  'Заняття можна створити лише для групи зі статусом PLANNED або ACTIVE.';
export const PRACTICE_INSTRUCTOR_REQUIRED_MESSAGE =
  'Студенту не призначено інструктора. Передайте instructorId.';
export const LESSON_HAS_ATTENDANCE_MESSAGE =
  'Заняття з відміченим відвідуванням не можна перенести.';

const HOUR_MS = 60 * 60_000;

const OPEN_GROUP_STATUSES: GroupStatus[] = [
  GroupStatus.PLANNED,
  GroupStatus.ACTIVE,
];

/** Група заняття з полями, потрібними перевіркам розкладу теорії. */
const lessonGroupSelect = {
  id: true,
  name: true,
  status: true,
  teacherId: true,
  startDate: true,
  endDate: true,
  teacher: {
    select: { ...lessonPersonSelect, status: true, deletedAt: true },
  },
} satisfies Prisma.GroupSelect;

/** Надмножина theoryLessonViewSelect: решта полів потрібна перевіркам запису. */
const theoryLessonSelect = {
  id: true,
  groupId: true,
  topic: true,
  scheduledAt: true,
  durationMin: true,
  status: true,
  cancelledAt: true,
  cancellationReason: true,
  updatedAt: true,
  group: { select: lessonGroupSelect },
} satisfies Prisma.LessonSelect;

type TheoryLessonRow = Prisma.LessonGetPayload<{
  select: typeof theoryLessonSelect;
}>;

type TheoryChange = {
  topic?: string;
  scheduledAt?: Date;
  durationMin?: number;
};

type PracticeChange = {
  scheduledAt?: Date;
  durationMin?: number;
  instructorId?: string;
  carId?: string;
  meetingPlace?: string;
};

export function assertCanEditTheory(actor: User): void {
  if (!(THEORY_LESSON_EDIT_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

/**
 * Група (FOR SHARE) → заняття (FOR UPDATE). Порядок той самий, що в
 * GroupsService.changeStatus. Заняття іншої організації — 404. Читання з
 * потрібним select робить викликач: після блокування воно бачить збережений стан.
 */
export async function lockTheoryLessonWithGroup(
  tx: Prisma.TransactionClient,
  organizationId: string,
  lessonId: string,
): Promise<void> {
  const target = await tx.lesson.findFirst({
    where: { id: lessonId, organizationId },
    select: { groupId: true },
  });
  if (!target) {
    throw new NotFoundException(LESSON_NOT_FOUND_MESSAGE);
  }

  // Закриття групи, що вже йде, завершиться раніше, і нижче ми побачимо
  // закриту групу.
  await lockGroup(tx, target.groupId, organizationId, 'share');
  await lockTheoryLesson(tx, lessonId, organizationId);
}

function assertRole(actor: User, roles: readonly UserRole[]): void {
  if (!roles.includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function fieldError(field: string, message: string): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    errors: [{ field, message }],
  });
}

function isEmptyPayload(payload: object): boolean {
  return Object.values(payload).every((value) => value === undefined);
}

function assertEditable(
  status: LessonStatus,
  message: string = LESSON_NOT_EDITABLE_MESSAGE,
): void {
  if (status !== LessonStatus.SCHEDULED) {
    throw new ConflictException({
      statusCode: 409,
      message,
      error: 'Conflict',
      currentStatus: status,
    });
  }
}

/**
 * Новий розклад має починатися в майбутньому. Перенесення в минуле — помилка
 * поля scheduledAt; зміна тривалості, інструктора чи авто для заняття, що вже
 * почалося, — конфлікт зі станом заняття.
 */
function assertStartsInFuture(
  scheduledAt: Date,
  now: Date,
  timeChanged: boolean,
): void {
  if (scheduledAt.getTime() > now.getTime()) {
    return;
  }
  if (timeChanged) {
    throw fieldError('scheduledAt', LESSON_IN_PAST_MESSAGE);
  }
  throw new ConflictException(LESSON_ALREADY_STARTED_MESSAGE);
}

/**
 * Скасовується лише розклад. Минуле SCHEDULED-заняття — це облік
 * відвідування, як і в GroupsService.changeStatus.
 */
function assertNotStarted(scheduledAt: Date, now: Date): void {
  if (scheduledAt.getTime() <= now.getTime()) {
    throw new ConflictException(LESSON_CANCEL_STARTED_MESSAGE);
  }
}

/** Нове заняття створюється лише в майбутньому; перевірка не потребує БД. */
function assertCreatableAt(scheduledAt: Date, now: Date): void {
  if (scheduledAt.getTime() <= now.getTime()) {
    throw fieldError('scheduledAt', LESSON_CREATE_IN_PAST_MESSAGE);
  }
}

/** Дати групи зберігаються як UTC-північ дня, тож ISO-рядок дає саму дату. */
function assertWithinGroupDates(
  scheduledAt: Date,
  group: { startDate: Date | null; endDate: Date | null },
  timeZone: string,
): void {
  const day = localDate(scheduledAt, timeZone);
  const start = group.startDate?.toISOString().slice(0, 10);
  const end = group.endDate?.toISOString().slice(0, 10);
  if ((start && day < start) || (end && day > end)) {
    throw fieldError('scheduledAt', LESSON_OUTSIDE_GROUP_DATES_MESSAGE);
  }
}

function assertTeacherActive(teacher: {
  status: UserStatus;
  deletedAt: Date | null;
}): void {
  if (teacher.deletedAt || teacher.status !== UserStatus.ACTIVE) {
    throw new ConflictException(LESSON_TEACHER_NOT_ACTIVE_MESSAGE);
  }
}

@Injectable()
export class LessonsService {
  private readonly logger = new Logger(LessonsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payment: PracticePaymentService,
  ) {}

  /**
   * Нове теоретичне заняття групи. Викладач заняття — викладач групи. Порядок
   * блокувань той самий, що в changeTheory: група (FOR SHARE) → advisory-ключі.
   */
  async createTheory(
    actor: User,
    payload: CreateTheoryLessonDto,
  ): Promise<TheoryLessonDto> {
    assertCanEditTheory(actor);
    const scheduledAt = new Date(payload.scheduledAt);
    const durationMin = payload.durationMin ?? THEORY_DEFAULT_DURATION_MIN;
    assertCreatableAt(scheduledAt, new Date());
    const organization = await this.requireOrganization(actor.organizationId);

    const saved = await this.prisma.$transaction(async (tx) => {
      // Закриття групи, що вже йде, завершиться раніше, і нижче ми побачимо
      // закриту групу.
      await lockGroup(tx, payload.groupId, actor.organizationId, 'share');
      const group = await tx.group.findFirst({
        where: { id: payload.groupId, organizationId: actor.organizationId },
        select: lessonGroupSelect,
      });
      if (!group) {
        throw new NotFoundException(GROUP_NOT_FOUND_MESSAGE);
      }
      if (actor.role === UserRole.TEACHER && group.teacherId !== actor.id) {
        throw new ForbiddenException('Insufficient permissions');
      }
      if (!OPEN_GROUP_STATUSES.includes(group.status)) {
        throw new ConflictException(LESSON_GROUP_NOT_OPEN_MESSAGE);
      }
      assertWithinGroupDates(scheduledAt, group, organization.timezone);
      assertTeacherActive(group.teacher);

      await this.assertTheorySlotFree(tx, actor, {
        lessonId: null,
        groupId: group.id,
        teacherId: group.teacherId,
        slot: lessonSlot(scheduledAt, durationMin),
      });

      return tx.lesson.create({
        data: {
          organizationId: actor.organizationId,
          groupId: group.id,
          topic: payload.topic,
          scheduledAt,
          durationMin,
        },
        select: theoryLessonSelect,
      });
    });

    this.logger.log(
      `Lesson created type=THEORY lessonId=${saved.id} groupId=${saved.groupId} scheduledAt=${saved.scheduledAt.toISOString()} durationMin=${saved.durationMin} actorId=${actor.id} organizationId=${actor.organizationId}`,
    );
    return toTheoryLessonDto(saved);
  }

  /**
   * Нове практичне заняття студента. Інструктор і авто без явних id беруться з
   * допуску студента до практики. Робочий графік інструктора не перевіряється:
   * так ADMIN додає разову зміну; недоступність — перевіряється. Рядка заняття
   * ще немає, тож row-lock не береться.
   */
  async createPractice(
    actor: User,
    payload: CreatePracticeLessonDto,
  ): Promise<PracticeLessonDto> {
    assertRole(actor, PRACTICE_LESSON_SCHEDULE_ROLES);
    const scheduledAt = new Date(payload.scheduledAt);
    const durationMin = payload.durationMin ?? PRACTICE_DEFAULT_DURATION_MIN;
    assertCreatableAt(scheduledAt, new Date());
    await this.requireOrganization(actor.organizationId);

    const saved = await this.prisma.$transaction(async (tx) => {
      const student = await tx.user.findFirst({
        where: {
          id: payload.studentId,
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
      const profile = requirePracticeProfile(student);

      const instructorId = payload.instructorId ?? profile.instructorId;
      if (!instructorId) {
        throw new ConflictException(PRACTICE_INSTRUCTOR_REQUIRED_MESSAGE);
      }
      await requireInstructor(tx, actor.organizationId, instructorId);

      const carId = payload.carId ?? profile.carId;
      if (!carId) {
        throw new ConflictException(PRACTICE_CAR_REQUIRED_MESSAGE);
      }
      await requirePracticeCar(tx, actor.organizationId, carId, {
        instructorId,
        category: profile.category,
        transmission: profile.transmission,
      });

      await this.assertPracticeSlotFree(tx, actor, {
        lessonId: null,
        instructorId,
        carId,
        studentId: student.id,
        slot: lessonSlot(scheduledAt, durationMin),
      });

      const paymentStatus = await this.payment.resolveForLesson(tx, {
        organizationId: actor.organizationId,
        studentId: student.id,
      });

      // Заняття від ADMIN не чекає підтвердження інструктора.
      return tx.drivingLesson.create({
        data: {
          organizationId: actor.organizationId,
          instructorId,
          studentId: student.id,
          carId,
          scheduledAt,
          durationMin,
          meetingPlace: payload.meetingPlace,
          confirmationStatus: BookingConfirmation.CONFIRMED,
          confirmedAt: new Date(),
          confirmedById: actor.id,
          paymentStatus,
        },
        select: practiceLessonSelect,
      });
    });

    this.logger.log(
      `Lesson created type=PRACTICE lessonId=${saved.id} instructorId=${saved.instructorId} studentId=${saved.studentId} carId=${saved.carId} scheduledAt=${saved.scheduledAt.toISOString()} durationMin=${saved.durationMin} actorId=${actor.id} organizationId=${actor.organizationId}`,
    );
    return toPracticeLessonDto(saved);
  }

  async updateTheory(
    actor: User,
    lessonId: string,
    payload: UpdateTheoryLessonDto,
  ): Promise<TheoryLessonDto> {
    assertCanEditTheory(actor);
    if (isEmptyPayload(payload)) {
      throw fieldError('body', NO_THEORY_LESSON_FIELDS_MESSAGE);
    }
    return this.changeTheory(actor, lessonId, {
      topic: payload.topic,
      durationMin: payload.durationMin,
    });
  }

  async rescheduleTheory(
    actor: User,
    lessonId: string,
    payload: RescheduleLessonDto,
  ): Promise<TheoryLessonDto> {
    assertCanEditTheory(actor);
    return this.changeTheory(actor, lessonId, {
      scheduledAt: new Date(payload.scheduledAt),
      durationMin: payload.durationMin,
    });
  }

  async updatePractice(
    actor: User,
    lessonId: string,
    payload: UpdatePracticeLessonDto,
  ): Promise<PracticeLessonDto> {
    assertRole(actor, PRACTICE_LESSON_EDIT_ROLES);
    if (isEmptyPayload(payload)) {
      throw fieldError('body', NO_PRACTICE_LESSON_FIELDS_MESSAGE);
    }
    // Зміна тривалості, авто чи інструктора — це зміна розкладу: лише ADMIN.
    if (
      actor.role !== UserRole.ADMIN &&
      (payload.durationMin !== undefined ||
        payload.instructorId !== undefined ||
        payload.carId !== undefined)
    ) {
      throw new ForbiddenException(LESSON_INSTRUCTOR_FIELDS_MESSAGE);
    }
    return this.changePractice(actor, lessonId, {
      durationMin: payload.durationMin,
      instructorId: payload.instructorId,
      carId: payload.carId,
      meetingPlace: payload.meetingPlace,
    });
  }

  async reschedulePractice(
    actor: User,
    lessonId: string,
    payload: RescheduleLessonDto,
  ): Promise<PracticeLessonDto> {
    assertRole(actor, PRACTICE_LESSON_RESCHEDULE_ROLES);
    if (actor.role === UserRole.STUDENT) {
      return this.rescheduleOwnBooking(actor, lessonId, payload);
    }
    return this.changePractice(actor, lessonId, {
      scheduledAt: new Date(payload.scheduledAt),
      durationMin: payload.durationMin,
    });
  }

  /**
   * Студент переносить своє бронювання (PENDING чи CONFIRMED) на інший вільний
   * слот однією транзакцією: старий час звільняється, лише якщо новий вдалося
   * зайняти. Правила: не пізніше ніж за STUDENT_RESCHEDULE_MIN_HOURS до
   * поточного початку; новий час — старт сітки робочого графіка інструктора,
   * щонайменше за BOOKING_MIN_LEAD_HOURS, без конфліктів. Перенесене
   * бронювання знову чекає підтвердження (PENDING). Порядок блокувань той
   * самий, що в changePractice: заняття (FOR UPDATE) → advisory-ключі.
   */
  private async rescheduleOwnBooking(
    actor: User,
    lessonId: string,
    payload: RescheduleLessonDto,
  ): Promise<PracticeLessonDto> {
    if (payload.durationMin !== undefined) {
      throw new ForbiddenException(STUDENT_DURATION_MESSAGE);
    }
    const now = new Date();
    const scheduledAt = new Date(payload.scheduledAt);
    if (scheduledAt.getTime() <= now.getTime()) {
      throw fieldError('scheduledAt', BOOKING_IN_PAST_MESSAGE);
    }
    if (
      scheduledAt.getTime() - now.getTime() <
      BOOKING_MIN_LEAD_HOURS * HOUR_MS
    ) {
      throw new ConflictException(BOOKING_TOO_SOON_MESSAGE);
    }
    const organization = await this.requireOrganization(actor.organizationId);

    const result = await this.prisma.$transaction(async (tx) => {
      const lesson = await lockPracticeLessonForChange(tx, actor, lessonId);
      // REJECTED і CANCELLED уже звільнили час: замість перенесення — нове бронювання.
      if (lesson.status !== LessonStatus.SCHEDULED) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message: STUDENT_RESCHEDULE_NOT_ACTIVE_MESSAGE,
          currentStatus: practiceBookingStatus(lesson),
        });
      }
      if (
        lesson.scheduledAt.getTime() - now.getTime() <
        STUDENT_RESCHEDULE_MIN_HOURS * HOUR_MS
      ) {
        throw new ConflictException(STUDENT_RESCHEDULE_TOO_LATE_MESSAGE);
      }
      if (lesson.scheduledAt.getTime() === scheduledAt.getTime()) {
        return { lesson, from: lesson.scheduledAt, changed: false };
      }
      if (!lesson.carId) {
        throw new ConflictException(PRACTICE_CAR_REQUIRED_MESSAGE);
      }
      const carId = lesson.carId;

      await lockPracticeResources(tx, {
        instructorId: lesson.instructorId,
        carId,
        studentId: lesson.studentId,
      });
      const profile = requirePracticeProfile(lesson.student);
      await requireInstructor(tx, actor.organizationId, lesson.instructorId);
      await requirePracticeCar(tx, actor.organizationId, carId, {
        instructorId: lesson.instructorId,
        category: profile.category,
        transmission: profile.transmission,
      });

      const workingHours = await tx.instructorWorkingHours.findMany({
        where: {
          organizationId: actor.organizationId,
          instructorId: lesson.instructorId,
        },
        select: { dayOfWeek: true, startMinute: true, endMinute: true },
      });
      if (
        !isSlotStart({
          scheduledAt,
          timeZone: organization.timezone,
          durationMin: PRACTICE_BOOKING_DURATION_MIN,
          workingHours,
        })
      ) {
        throw new ConflictException(SLOT_NOT_OPEN_MESSAGE);
      }

      const conflicts = await findPracticeConflicts(tx, {
        organizationId: actor.organizationId,
        lessonId: lesson.id,
        instructorId: lesson.instructorId,
        carId,
        studentId: lesson.studentId,
        slot: lessonSlot(scheduledAt, lesson.durationMin),
      });
      if (conflicts.length > 0) {
        this.logger.log(
          `Lesson schedule conflict type=PRACTICE lessonId=${lesson.id} conflicts=${conflicts.length} actorId=${actor.id} organizationId=${actor.organizationId}`,
        );
        throw scheduleConflict(conflicts);
      }

      const saved = await tx.drivingLesson.update({
        where: { id: lesson.id },
        data: {
          scheduledAt,
          confirmationStatus: BookingConfirmation.PENDING,
          confirmedAt: null,
          confirmedById: null,
        },
        select: practiceLessonSelect,
      });
      return { lesson: saved, from: lesson.scheduledAt, changed: true };
    });

    if (result.changed) {
      this.logger.log(
        `Practice booking rescheduled by student lessonId=${result.lesson.id} from=${result.from.toISOString()} to=${result.lesson.scheduledAt.toISOString()} actorId=${actor.id} organizationId=${actor.organizationId}`,
      );
    }
    return toPracticeLessonDto(result.lesson);
  }

  /**
   * Заняття не видаляється: статус стає CANCELLED, і пошук конфліктів та
   * дашборди перестають його бачити, тож час викладача й групи звільняється.
   * Стан викладача не перевіряється: заблокований викладач — привід скасувати.
   */
  async cancelTheory(
    actor: User,
    lessonId: string,
    payload: CancelLessonDto,
  ): Promise<TheoryLessonDto> {
    assertCanEditTheory(actor);
    await this.requireOrganization(actor.organizationId);
    const now = new Date();

    const saved = await this.prisma.$transaction(async (tx) => {
      const lesson = await this.lockTheoryForChange(tx, actor, lessonId);
      // Спершу статус: повторне скасування завжди повертає currentStatus.
      assertEditable(lesson.status, LESSON_NOT_CANCELLABLE_MESSAGE);
      if (!OPEN_GROUP_STATUSES.includes(lesson.group.status)) {
        throw new ConflictException(LESSON_GROUP_CLOSED_MESSAGE);
      }
      assertNotStarted(lesson.scheduledAt, now);

      return tx.lesson.update({
        where: { id: lesson.id },
        data: {
          status: LessonStatus.CANCELLED,
          cancelledAt: now,
          cancelledById: actor.id,
          cancellationReason: payload.reason ?? null,
        },
        select: theoryLessonSelect,
      });
    });

    this.logger.log(
      `Lesson cancelled type=THEORY lessonId=${saved.id} scheduledAt=${saved.scheduledAt.toISOString()} actorId=${actor.id} organizationId=${actor.organizationId}`,
    );
    return toTheoryLessonDto(saved);
  }

  /**
   * Те саме для практики: звільняється час інструктора, авто і студента, і
   * година знову з'являється серед вільних слотів. Інструктор, авто і студент
   * лишаються в занятті як історія. STUDENT скасовує лише своє заняття:
   * запит, що чекає підтвердження, — будь-коли до початку, підтверджене
   * заняття — не пізніше ніж за STUDENT_CANCEL_MIN_HOURS. Інструктор без
   * причини скасовує з INSTRUCTOR_CANCEL_DEFAULT_REASON.
   */
  async cancelPractice(
    actor: User,
    lessonId: string,
    payload: CancelLessonDto,
  ): Promise<PracticeLessonDto> {
    assertRole(actor, PRACTICE_LESSON_CANCEL_ROLES);
    await this.requireOrganization(actor.organizationId);
    const now = new Date();

    const saved = await this.prisma.$transaction(async (tx) => {
      const lesson = await lockPracticeLessonForChange(tx, actor, lessonId);
      assertEditable(lesson.status, LESSON_NOT_CANCELLABLE_MESSAGE);
      assertNotStarted(lesson.scheduledAt, now);
      if (
        actor.role === UserRole.STUDENT &&
        lesson.confirmationStatus === BookingConfirmation.CONFIRMED &&
        lesson.scheduledAt.getTime() - now.getTime() <
          STUDENT_CANCEL_MIN_HOURS * HOUR_MS
      ) {
        throw new ConflictException(STUDENT_CANCEL_TOO_LATE_MESSAGE);
      }
      const defaultReason =
        actor.role === UserRole.INSTRUCTOR
          ? INSTRUCTOR_CANCEL_DEFAULT_REASON
          : null;

      return tx.drivingLesson.update({
        where: { id: lesson.id },
        data: {
          status: LessonStatus.CANCELLED,
          cancelledAt: now,
          cancelledById: actor.id,
          cancellationReason: payload.reason ?? defaultReason,
        },
        select: practiceLessonSelect,
      });
    });

    this.logger.log(
      `Lesson cancelled type=PRACTICE lessonId=${saved.id} scheduledAt=${saved.scheduledAt.toISOString()} actorId=${actor.id} organizationId=${actor.organizationId}`,
    );
    return toPracticeLessonDto(saved);
  }

  /**
   * Спільний конвеєр редагування і перенесення теорії. Порядок блокувань:
   * група (FOR SHARE) → заняття (FOR UPDATE) → advisory-ключі. Порядок
   * «група → заняття» той самий, що в GroupsService.changeStatus.
   */
  private async changeTheory(
    actor: User,
    lessonId: string,
    change: TheoryChange,
  ): Promise<TheoryLessonDto> {
    const organization = await this.requireOrganization(actor.organizationId);
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const lesson = await this.lockTheoryForChange(tx, actor, lessonId);
      assertEditable(lesson.status);
      if (!OPEN_GROUP_STATUSES.includes(lesson.group.status)) {
        throw new ConflictException(LESSON_GROUP_CLOSED_MESSAGE);
      }

      const next = {
        topic: change.topic ?? lesson.topic,
        scheduledAt: change.scheduledAt ?? lesson.scheduledAt,
        durationMin: change.durationMin ?? lesson.durationMin,
      };
      const data: TheoryChange = {};
      if (next.topic !== lesson.topic) {
        data.topic = next.topic;
      }
      if (next.scheduledAt.getTime() !== lesson.scheduledAt.getTime()) {
        data.scheduledAt = next.scheduledAt;
      }
      if (next.durationMin !== lesson.durationMin) {
        data.durationMin = next.durationMin;
      }
      if (Object.keys(data).length === 0) {
        return { lesson, changed: [] as string[] };
      }

      if (data.scheduledAt !== undefined || data.durationMin !== undefined) {
        assertStartsInFuture(
          next.scheduledAt,
          now,
          change.scheduledAt !== undefined,
        );
        // Відмітки описують заняття, що вже відбулося. PATCH відвідування бере
        // те саме блокування заняття, тож гонки між перевіркою і записом немає.
        if (data.scheduledAt !== undefined) {
          const marked = await tx.lessonAttendance.count({
            where: { lessonId: lesson.id },
          });
          if (marked > 0) {
            throw new ConflictException(LESSON_HAS_ATTENDANCE_MESSAGE);
          }
        }
        assertWithinGroupDates(
          next.scheduledAt,
          lesson.group,
          organization.timezone,
        );
        assertTeacherActive(lesson.group.teacher);

        await this.assertTheorySlotFree(tx, actor, {
          lessonId: lesson.id,
          groupId: lesson.groupId,
          teacherId: lesson.group.teacherId,
          slot: lessonSlot(next.scheduledAt, next.durationMin),
        });
      }

      const saved = await tx.lesson.update({
        where: { id: lesson.id },
        data,
        select: theoryLessonSelect,
      });
      return { lesson: saved, changed: Object.keys(data) };
    });

    if (result.changed.length > 0) {
      this.logger.log(
        `Lesson updated type=THEORY lessonId=${result.lesson.id} fields=${result.changed.join(',')} scheduledAt=${result.lesson.scheduledAt.toISOString()} actorId=${actor.id} organizationId=${actor.organizationId}`,
      );
    }
    return toTheoryLessonDto(result.lesson);
  }

  /**
   * Спільний конвеєр редагування і перенесення практики. Порядок блокувань:
   * заняття (FOR UPDATE) → advisory-ключі.
   */
  private async changePractice(
    actor: User,
    lessonId: string,
    change: PracticeChange,
  ): Promise<PracticeLessonDto> {
    await this.requireOrganization(actor.organizationId);
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const lesson = await lockPracticeLessonForChange(tx, actor, lessonId);
      assertEditable(lesson.status);

      // Старе заняття без авто бере авто, призначене студенту, але лише разом
      // зі зміною розкладу: правка самого місця зустрічі розклад не чіпає.
      const touchesSchedule =
        change.scheduledAt !== undefined ||
        change.durationMin !== undefined ||
        change.instructorId !== undefined ||
        change.carId !== undefined;
      const next = {
        scheduledAt: change.scheduledAt ?? lesson.scheduledAt,
        durationMin: change.durationMin ?? lesson.durationMin,
        instructorId: change.instructorId ?? lesson.instructorId,
        carId:
          change.carId ??
          lesson.carId ??
          (touchesSchedule
            ? (lesson.student.studentProfile?.carId ?? null)
            : null),
      };
      const data: PracticeChange = {};
      if (next.scheduledAt.getTime() !== lesson.scheduledAt.getTime()) {
        data.scheduledAt = next.scheduledAt;
      }
      if (next.durationMin !== lesson.durationMin) {
        data.durationMin = next.durationMin;
      }
      if (next.instructorId !== lesson.instructorId) {
        data.instructorId = next.instructorId;
      }
      if (next.carId !== null && next.carId !== lesson.carId) {
        data.carId = next.carId;
      }
      if (
        change.meetingPlace !== undefined &&
        change.meetingPlace !== lesson.meetingPlace
      ) {
        data.meetingPlace = change.meetingPlace;
      }
      if (Object.keys(data).length === 0) {
        return { lesson, changed: [] as string[] };
      }

      // Зміна лише місця зустрічі не перевіряє розклад, як зміна лише topic
      // у теорії: її можна внести, навіть коли авто на ремонті.
      const scheduleChanged =
        data.scheduledAt !== undefined ||
        data.durationMin !== undefined ||
        data.instructorId !== undefined ||
        data.carId !== undefined;
      if (scheduleChanged) {
        assertStartsInFuture(
          next.scheduledAt,
          now,
          change.scheduledAt !== undefined,
        );
        const profile = requirePracticeProfile(lesson.student);
        if (next.instructorId === lesson.instructorId) {
          assertInstructorActive(lesson.instructor);
        } else {
          await requireInstructor(tx, actor.organizationId, next.instructorId);
        }
        if (next.carId === null) {
          throw new ConflictException(PRACTICE_CAR_REQUIRED_MESSAGE);
        }
        await requirePracticeCar(tx, actor.organizationId, next.carId, {
          instructorId: next.instructorId,
          category: profile.category,
          transmission: profile.transmission,
        });

        await this.assertPracticeSlotFree(tx, actor, {
          lessonId: lesson.id,
          instructorId: next.instructorId,
          carId: next.carId,
          studentId: lesson.studentId,
          slot: lessonSlot(next.scheduledAt, next.durationMin),
        });
      }

      const saved = await tx.drivingLesson.update({
        where: { id: lesson.id },
        data,
        select: practiceLessonSelect,
      });
      return { lesson: saved, changed: Object.keys(data) };
    });

    if (result.changed.length > 0) {
      this.logger.log(
        `Lesson updated type=PRACTICE lessonId=${result.lesson.id} fields=${result.changed.join(',')} scheduledAt=${result.lesson.scheduledAt.toISOString()} actorId=${actor.id} organizationId=${actor.organizationId}`,
      );
    }
    return toPracticeLessonDto(result.lesson);
  }

  /**
   * Advisory-ключі викладача й групи → пошук конфліктів теорії. Викликається
   * після всіх row-lock'ів транзакції. lessonId — null для нового заняття.
   */
  private async assertTheorySlotFree(
    tx: Prisma.TransactionClient,
    actor: User,
    input: {
      lessonId: string | null;
      groupId: string;
      teacherId: string;
      slot: ScheduleSlot;
    },
  ): Promise<void> {
    await lockScheduleResources(tx, [
      scheduleLockKey('teacher', input.teacherId),
      scheduleLockKey('group', input.groupId),
    ]);
    const conflicts = await findTheoryConflicts(tx, {
      organizationId: actor.organizationId,
      ...input,
    });
    if (conflicts.length > 0) {
      this.logger.log(
        `Lesson schedule conflict type=THEORY lessonId=${input.lessonId ?? 'new'} conflicts=${conflicts.length} actorId=${actor.id} organizationId=${actor.organizationId}`,
      );
      throw scheduleConflict(conflicts);
    }
  }

  /**
   * Advisory-ключі інструктора, авто, студента і його відкритих груп → пошук
   * конфліктів практики. Спільний ключ group: серіалізує практику студента з
   * теорією його групи.
   */
  private async assertPracticeSlotFree(
    tx: Prisma.TransactionClient,
    actor: User,
    input: {
      lessonId: string | null;
      instructorId: string;
      carId: string;
      studentId: string;
      slot: ScheduleSlot;
    },
  ): Promise<void> {
    await lockPracticeResources(tx, input);
    const conflicts = await findPracticeConflicts(tx, {
      organizationId: actor.organizationId,
      ...input,
    });
    if (conflicts.length > 0) {
      this.logger.log(
        `Lesson schedule conflict type=PRACTICE lessonId=${input.lessonId ?? 'new'} conflicts=${conflicts.length} actorId=${actor.id} organizationId=${actor.organizationId}`,
      );
      throw scheduleConflict(conflicts);
    }
  }

  /**
   * Блокує групу (FOR SHARE), потім заняття (FOR UPDATE) і читає заняття.
   * Заняття іншої організації — 404, заняття чужої групи для TEACHER — 403.
   */
  private async lockTheoryForChange(
    tx: Prisma.TransactionClient,
    actor: User,
    lessonId: string,
  ): Promise<TheoryLessonRow> {
    await lockTheoryLessonWithGroup(tx, actor.organizationId, lessonId);
    const lesson = await tx.lesson.findFirst({
      where: { id: lessonId, organizationId: actor.organizationId },
      select: theoryLessonSelect,
    });
    if (!lesson) {
      throw new NotFoundException(LESSON_NOT_FOUND_MESSAGE);
    }
    if (
      actor.role === UserRole.TEACHER &&
      lesson.group.teacherId !== actor.id
    ) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return lesson;
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
