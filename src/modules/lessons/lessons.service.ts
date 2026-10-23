import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CarStatus,
  DrivingLessonStatus,
  EnrollmentStatus,
  GroupStatus,
  LessonStatus,
  LicenseCategory,
  Prisma,
  TrainingStatus,
  Transmission,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { lockGroup } from '../../common/prisma/group-lock';
import {
  lockPracticeLesson,
  lockScheduleResources,
  lockTheoryLesson,
  scheduleLockKey,
} from '../../common/prisma/schedule-lock';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CAR_NOT_FOUND_MESSAGE,
  INSTRUCTOR_NOT_ACTIVE_MESSAGE,
  INSTRUCTOR_NOT_FOUND_MESSAGE,
  INSTRUCTOR_ROLE_MESSAGE,
} from '../cars/cars.service';
import {
  CAR_NOT_AVAILABLE_MESSAGE,
  INSTRUCTOR_CAR_MISMATCH_MESSAGE,
} from '../students/students.service';
import {
  lessonPersonSelect,
  toPracticeLessonDto,
  toTheoryLessonDto,
} from './lesson-view';
import {
  CancelLessonDto,
  PracticeLessonDto,
  RescheduleLessonDto,
  TheoryLessonDto,
  UpdatePracticeLessonDto,
  UpdateTheoryLessonDto,
} from './lessons.dto';
import {
  findPracticeConflicts,
  findTheoryConflicts,
  lessonSlot,
  scheduleConflict,
} from './schedule-conflicts';

export const THEORY_LESSON_EDIT_ROLES = [
  UserRole.ADMIN,
  UserRole.TEACHER,
] as const;

export const PRACTICE_LESSON_EDIT_ROLES = [
  UserRole.ADMIN,
  UserRole.INSTRUCTOR,
] as const;

export const LESSON_NOT_FOUND_MESSAGE = 'Lesson not found';
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
export const STUDENT_NOT_IN_PRACTICE_MESSAGE =
  'Студент має бути активним і мати допуск до практики (PRACTICE).';
export const PRACTICE_CAR_REQUIRED_MESSAGE =
  'Для практичного заняття потрібен автомобіль. Передайте carId.';
export const LESSON_INSTRUCTOR_CHANGE_MESSAGE =
  'Змінити інструктора заняття може лише ADMIN.';
export const NO_THEORY_LESSON_FIELDS_MESSAGE =
  'Немає дозволених полів для оновлення (topic, durationMin).';
export const NO_PRACTICE_LESSON_FIELDS_MESSAGE =
  'Немає дозволених полів для оновлення (durationMin, instructorId, carId).';
export const LESSON_NOT_CANCELLABLE_MESSAGE =
  'Скасувати можна лише заняття зі статусом SCHEDULED.';
export const LESSON_CANCEL_STARTED_MESSAGE =
  'Скасувати можна лише заняття, яке ще не почалося.';

const OPEN_GROUP_STATUSES: GroupStatus[] = [
  GroupStatus.PLANNED,
  GroupStatus.ACTIVE,
];

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
  group: {
    select: {
      id: true,
      name: true,
      status: true,
      teacherId: true,
      startDate: true,
      endDate: true,
      teacher: {
        select: { ...lessonPersonSelect, status: true, deletedAt: true },
      },
    },
  },
} satisfies Prisma.LessonSelect;

type TheoryLessonRow = Prisma.LessonGetPayload<{
  select: typeof theoryLessonSelect;
}>;

/** Надмножина practiceLessonViewSelect: решта полів потрібна перевіркам запису. */
const practiceLessonSelect = {
  id: true,
  instructorId: true,
  studentId: true,
  carId: true,
  scheduledAt: true,
  durationMin: true,
  status: true,
  cancelledAt: true,
  cancellationReason: true,
  updatedAt: true,
  instructor: {
    select: {
      ...lessonPersonSelect,
      role: true,
      status: true,
      deletedAt: true,
    },
  },
  student: {
    select: {
      ...lessonPersonSelect,
      status: true,
      deletedAt: true,
      studentProfile: {
        select: {
          trainingStatus: true,
          category: true,
          transmission: true,
          carId: true,
        },
      },
    },
  },
  car: {
    select: { id: true, plateNumber: true, category: true, transmission: true },
  },
} satisfies Prisma.DrivingLessonSelect;

type PracticeLessonRow = Prisma.DrivingLessonGetPayload<{
  select: typeof practiceLessonSelect;
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
};

function assertCanEditTheory(actor: User): void {
  if (!(THEORY_LESSON_EDIT_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function assertCanEditPractice(actor: User): void {
  if (
    !(PRACTICE_LESSON_EDIT_ROLES as readonly UserRole[]).includes(actor.role)
  ) {
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
  status: LessonStatus | DrivingLessonStatus,
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

/** Місцева дата у форматі YYYY-MM-DD (en-CA). */
function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
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

function assertInstructorActive(instructor: {
  role: UserRole;
  status: UserStatus;
  deletedAt: Date | null;
}): void {
  if (instructor.role !== UserRole.INSTRUCTOR) {
    throw new ConflictException(INSTRUCTOR_ROLE_MESSAGE);
  }
  if (instructor.deletedAt || instructor.status !== UserStatus.ACTIVE) {
    throw new ConflictException(INSTRUCTOR_NOT_ACTIVE_MESSAGE);
  }
}

/**
 * Допуск до практики вже має бути (PRACTICE). ACTIVE тут не підходить, хоча
 * isEligibleForPractice у students його приймає: там перевіряється право
 * отримати допуск.
 */
function requirePracticeProfile(student: PracticeLessonRow['student']) {
  const profile = student.studentProfile;
  if (
    student.deletedAt ||
    student.status !== UserStatus.ACTIVE ||
    !profile ||
    profile.trainingStatus !== TrainingStatus.PRACTICE
  ) {
    throw new ConflictException(STUDENT_NOT_IN_PRACTICE_MESSAGE);
  }
  return profile;
}

@Injectable()
export class LessonsService {
  private readonly logger = new Logger(LessonsService.name);

  constructor(private readonly prisma: PrismaService) {}

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
    assertCanEditPractice(actor);
    if (isEmptyPayload(payload)) {
      throw fieldError('body', NO_PRACTICE_LESSON_FIELDS_MESSAGE);
    }
    if (payload.instructorId !== undefined && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException(LESSON_INSTRUCTOR_CHANGE_MESSAGE);
    }
    return this.changePractice(actor, lessonId, {
      durationMin: payload.durationMin,
      instructorId: payload.instructorId,
      carId: payload.carId,
    });
  }

  async reschedulePractice(
    actor: User,
    lessonId: string,
    payload: RescheduleLessonDto,
  ): Promise<PracticeLessonDto> {
    assertCanEditPractice(actor);
    return this.changePractice(actor, lessonId, {
      scheduledAt: new Date(payload.scheduledAt),
      durationMin: payload.durationMin,
    });
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
   * Те саме для практики: звільняється час інструктора, авто і студента.
   * Інструктор, авто і студент лишаються в занятті як історія.
   */
  async cancelPractice(
    actor: User,
    lessonId: string,
    payload: CancelLessonDto,
  ): Promise<PracticeLessonDto> {
    assertCanEditPractice(actor);
    await this.requireOrganization(actor.organizationId);
    const now = new Date();

    const saved = await this.prisma.$transaction(async (tx) => {
      const lesson = await this.lockPracticeForChange(tx, actor, lessonId);
      assertEditable(lesson.status, LESSON_NOT_CANCELLABLE_MESSAGE);
      assertNotStarted(lesson.scheduledAt, now);

      return tx.drivingLesson.update({
        where: { id: lesson.id },
        data: {
          status: DrivingLessonStatus.CANCELLED,
          cancelledAt: now,
          cancelledById: actor.id,
          cancellationReason: payload.reason ?? null,
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
        assertWithinGroupDates(
          next.scheduledAt,
          lesson.group,
          organization.timezone,
        );
        assertTeacherActive(lesson.group.teacher);

        await lockScheduleResources(tx, [
          scheduleLockKey('teacher', lesson.group.teacherId),
          scheduleLockKey('group', lesson.groupId),
        ]);
        const conflicts = await findTheoryConflicts(tx, {
          organizationId: actor.organizationId,
          lessonId: lesson.id,
          groupId: lesson.groupId,
          teacherId: lesson.group.teacherId,
          slot: lessonSlot(next.scheduledAt, next.durationMin),
        });
        if (conflicts.length > 0) {
          this.logger.log(
            `Lesson schedule conflict type=THEORY lessonId=${lesson.id} conflicts=${conflicts.length} actorId=${actor.id} organizationId=${actor.organizationId}`,
          );
          throw scheduleConflict(conflicts);
        }
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
      const lesson = await this.lockPracticeForChange(tx, actor, lessonId);
      assertEditable(lesson.status);

      // Старе заняття без авто бере авто, призначене студенту.
      const next = {
        scheduledAt: change.scheduledAt ?? lesson.scheduledAt,
        durationMin: change.durationMin ?? lesson.durationMin,
        instructorId: change.instructorId ?? lesson.instructorId,
        carId:
          change.carId ??
          lesson.carId ??
          lesson.student.studentProfile?.carId ??
          null,
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
      if (Object.keys(data).length === 0) {
        return { lesson, changed: [] as string[] };
      }

      assertStartsInFuture(
        next.scheduledAt,
        now,
        change.scheduledAt !== undefined,
      );
      const profile = requirePracticeProfile(lesson.student);
      if (next.instructorId === lesson.instructorId) {
        assertInstructorActive(lesson.instructor);
      } else {
        await this.requireInstructor(
          tx,
          actor.organizationId,
          next.instructorId,
        );
      }
      if (next.carId === null) {
        throw new ConflictException(PRACTICE_CAR_REQUIRED_MESSAGE);
      }
      await this.requirePracticeCar(tx, actor.organizationId, next.carId, {
        instructorId: next.instructorId,
        category: profile.category,
        transmission: profile.transmission,
      });

      // Спільний ключ group: серіалізує практику студента з теорією його групи.
      const studentGroups = await tx.enrollment.findMany({
        where: { studentId: lesson.studentId, status: EnrollmentStatus.ACTIVE },
        select: { groupId: true },
      });
      await lockScheduleResources(tx, [
        scheduleLockKey('instructor', next.instructorId),
        scheduleLockKey('car', next.carId),
        scheduleLockKey('student', lesson.studentId),
        ...studentGroups.map((row) => scheduleLockKey('group', row.groupId)),
      ]);

      const conflicts = await findPracticeConflicts(tx, {
        organizationId: actor.organizationId,
        lessonId: lesson.id,
        instructorId: next.instructorId,
        carId: next.carId,
        studentId: lesson.studentId,
        slot: lessonSlot(next.scheduledAt, next.durationMin),
      });
      if (conflicts.length > 0) {
        this.logger.log(
          `Lesson schedule conflict type=PRACTICE lessonId=${lesson.id} conflicts=${conflicts.length} actorId=${actor.id} organizationId=${actor.organizationId}`,
        );
        throw scheduleConflict(conflicts);
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
   * Блокує групу (FOR SHARE), потім заняття (FOR UPDATE) і читає заняття.
   * Заняття іншої організації — 404, заняття чужої групи для TEACHER — 403.
   */
  private async lockTheoryForChange(
    tx: Prisma.TransactionClient,
    actor: User,
    lessonId: string,
  ): Promise<TheoryLessonRow> {
    const target = await tx.lesson.findFirst({
      where: {
        id: lessonId,
        group: { organizationId: actor.organizationId },
      },
      select: { groupId: true },
    });
    if (!target) {
      throw new NotFoundException(LESSON_NOT_FOUND_MESSAGE);
    }

    // Закриття групи, що вже йде, завершиться раніше, і нижче ми побачимо
    // закриту групу.
    await lockGroup(tx, target.groupId, actor.organizationId, 'share');
    await lockTheoryLesson(tx, lessonId, actor.organizationId);
    const lesson = await tx.lesson.findFirst({
      where: {
        id: lessonId,
        group: { organizationId: actor.organizationId },
      },
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

  /**
   * Блокує заняття (FOR UPDATE) і читає його. Заняття іншої організації — 404,
   * чуже заняття для INSTRUCTOR — 403.
   */
  private async lockPracticeForChange(
    tx: Prisma.TransactionClient,
    actor: User,
    lessonId: string,
  ): Promise<PracticeLessonRow> {
    // Паралельна зміна того самого заняття чекає на цю транзакцію.
    await lockPracticeLesson(tx, lessonId, actor.organizationId);
    const lesson = await tx.drivingLesson.findFirst({
      where: { id: lessonId, organizationId: actor.organizationId },
      select: practiceLessonSelect,
    });
    if (!lesson) {
      throw new NotFoundException(LESSON_NOT_FOUND_MESSAGE);
    }
    if (
      actor.role === UserRole.INSTRUCTOR &&
      lesson.instructorId !== actor.id
    ) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return lesson;
  }

  /** Те саме правило, що CarsService.requireInstructor. */
  private async requireInstructor(
    tx: Prisma.TransactionClient,
    organizationId: string,
    instructorId: string,
  ): Promise<void> {
    const instructor = await tx.user.findUnique({
      where: { id: instructorId },
      select: {
        organizationId: true,
        role: true,
        status: true,
        deletedAt: true,
      },
    });
    if (
      !instructor ||
      instructor.deletedAt ||
      instructor.organizationId !== organizationId
    ) {
      throw new NotFoundException(INSTRUCTOR_NOT_FOUND_MESSAGE);
    }
    assertInstructorActive(instructor);
  }

  /** Те саме правило авто, що StudentsService.grantPracticeAccess. */
  private async requirePracticeCar(
    tx: Prisma.TransactionClient,
    organizationId: string,
    carId: string,
    expected: {
      instructorId: string;
      category: LicenseCategory | null;
      transmission: Transmission | null;
    },
  ): Promise<void> {
    const car = await tx.car.findUnique({
      where: { id: carId },
      select: {
        organizationId: true,
        instructorId: true,
        category: true,
        transmission: true,
        status: true,
      },
    });
    if (!car || car.organizationId !== organizationId) {
      throw new NotFoundException(CAR_NOT_FOUND_MESSAGE);
    }
    if (
      car.instructorId !== expected.instructorId ||
      car.category !== expected.category ||
      car.transmission !== expected.transmission
    ) {
      throw new ConflictException(INSTRUCTOR_CAR_MISMATCH_MESSAGE);
    }
    if (car.status !== CarStatus.AVAILABLE) {
      throw new ConflictException(CAR_NOT_AVAILABLE_MESSAGE);
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
