import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CourseLessonPublicationStatus,
  CoursePublicationStatus,
  CourseStatus,
  EnrollmentStatus,
  Prisma,
  TheoryTestAttemptStatus,
  User,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CourseLessonProgressDto,
  CourseProgressDto,
  LinkedTheorySessionDto,
  TheoryTestResultDto,
} from './course-progress.dto';
import { LESSON_NOT_FOUND_MESSAGE } from './course-structure.service';
import {
  LESSON_LOCKED_MESSAGE,
  LESSON_RETRY_MESSAGE,
  loadLessonGate,
  toLessonTestProgress,
} from './lesson-gate';
import {
  COURSE_NOT_FOUND_MESSAGE,
  COURSE_NOT_PUBLISHED_MESSAGE,
  COURSE_STUDENT_ROLES,
} from './courses.service';
import { syncTheoryCompletion } from '../students/theory-completion';

export const COURSE_PROGRESS_STAFF_ROLES = [
  UserRole.ADMIN,
  UserRole.TEACHER,
] as const;

export const COURSE_PROGRESS_NOT_FOUND_MESSAGE = 'Student progress not found';
export const COURSE_STUDENT_NOT_FOUND_MESSAGE = 'Student not found';

const VISIBLE_ENROLLMENT = [
  EnrollmentStatus.ACTIVE,
  EnrollmentStatus.COMPLETED,
] as const;

const lessonProgressSelect = {
  id: true,
  chapterId: true,
  title: true,
  position: true,
  chapter: { select: { position: true } },
} satisfies Prisma.CourseLessonSelect;

type LessonProgressRow = Prisma.CourseLessonGetPayload<{
  select: typeof lessonProgressSelect;
}>;

type SessionScope = {
  statuses: EnrollmentStatus[];
  teacherId?: string;
};

type ProgressSnapshot = {
  organizationId: string;
  completedLessonCount: number;
  totalLessonCount: number;
  percent: number;
  updatedAt: Date;
};

export function progressPercent(completed: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.round((completed * 100) / total);
}

function assertStudent(actor: User): void {
  if (!(COURSE_STUDENT_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function assertCanReadStudentProgress(actor: User): void {
  if (
    !(COURSE_PROGRESS_STAFF_ROLES as readonly UserRole[]).includes(actor.role)
  ) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function studentSessionScope(): SessionScope {
  return { statuses: [EnrollmentStatus.ACTIVE] };
}

function staffSessionScope(actor: User): SessionScope {
  return {
    statuses: [...VISIBLE_ENROLLMENT],
    ...(actor.role === UserRole.TEACHER ? { teacherId: actor.id } : {}),
  };
}

function enrollmentWhere(
  organizationId: string,
  courseId: string,
  studentId: string,
  teacherId?: string,
): Prisma.EnrollmentWhereInput {
  return {
    studentId,
    status: { in: [...VISIBLE_ENROLLMENT] },
    group: {
      organizationId,
      courseId,
      ...(teacherId ? { teacherId } : {}),
    },
  };
}

async function lockCourse(
  tx: Prisma.TransactionClient,
  courseId: string,
  organizationId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM courses
    WHERE id = ${courseId}::uuid AND organization_id = ${organizationId}::uuid
    FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new NotFoundException(COURSE_NOT_FOUND_MESSAGE);
  }
}

@Injectable()
export class CourseProgressService {
  private readonly logger = new Logger(CourseProgressService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Прогрес студента по опублікованому курсу його активної групи. */
  async getOwn(actor: User, courseId: string): Promise<CourseProgressDto> {
    assertStudent(actor);
    await this.requireOrganization(actor.organizationId);
    await this.requireAssignedPublishedCourse(this.prisma, actor, courseId);
    return this.loadProgress(
      actor.organizationId,
      courseId,
      actor.id,
      studentSessionScope(),
    );
  }

  /** Прогрес по курсу групи, у якій у студента активне зарахування. */
  async getCurrent(actor: User): Promise<CourseProgressDto> {
    assertStudent(actor);
    await this.requireOrganization(actor.organizationId);

    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        studentId: actor.id,
        status: EnrollmentStatus.ACTIVE,
        group: {
          organizationId: actor.organizationId,
          courseId: { not: null },
        },
      },
      orderBy: { enrolledAt: 'desc' },
      select: { group: { select: { courseId: true } } },
    });
    const courseId = enrollment?.group.courseId;
    if (!courseId) {
      throw new NotFoundException(COURSE_NOT_FOUND_MESSAGE);
    }
    await this.requireAssignedPublishedCourse(this.prisma, actor, courseId);
    return this.loadProgress(
      actor.organizationId,
      courseId,
      actor.id,
      studentSessionScope(),
    );
  }

  /**
   * Фіксує проходження уроку і перераховує збережений прогрес.
   * Повтор того самого уроку не створює другий запис і не змінює completedAt.
   */
  async completeLesson(
    actor: User,
    courseId: string,
    lessonId: string,
  ): Promise<CourseProgressDto> {
    assertStudent(actor);
    await this.requireOrganization(actor.organizationId);
    await this.requireAssignedPublishedCourse(this.prisma, actor, courseId);

    const progress = await this.prisma.$transaction(async (tx) => {
      await lockCourse(tx, courseId, actor.organizationId);
      await this.requireAssignedPublishedCourse(tx, actor, courseId);
      const lesson = await tx.courseLesson.findFirst({
        where: {
          id: lessonId,
          courseId,
          publicationStatus: CourseLessonPublicationStatus.PUBLISHED,
        },
        select: { id: true },
      });
      if (!lesson) {
        throw new NotFoundException(LESSON_NOT_FOUND_MESSAGE);
      }
      const gate = await loadLessonGate(
        tx,
        actor.organizationId,
        courseId,
        actor.id,
      );
      if (gate.locked.has(lessonId)) {
        throw new ForbiddenException(LESSON_LOCKED_MESSAGE);
      }
      const testState = gate.tests.get(lessonId);
      await this.markCompleted(
        tx,
        actor,
        courseId,
        lessonId,
        testState?.exhausted ? testState.cycle + 1 : null,
      );
      const progress = await this.syncProgress(
        tx,
        actor.organizationId,
        courseId,
        actor.id,
        studentSessionScope(),
      );
      await syncTheoryCompletion(tx, actor.id, actor.organizationId);
      return progress;
    });

    this.logger.log(
      `Course progress saved courseId=${courseId} lessonId=${lessonId} studentId=${actor.id} completedLessonCount=${progress.completedLessonCount} totalLessonCount=${progress.totalLessonCount} percent=${progress.percent} organizationId=${actor.organizationId} actorId=${actor.id}`,
    );
    return progress;
  }

  /**
   * ADMIN бачить прогрес студента своєї автошколи, зарахованого на цей курс.
   * TEACHER — лише студента групи, яку він веде і якій призначено цей курс.
   */
  async getForStudent(
    actor: User,
    courseId: string,
    studentId: string,
  ): Promise<CourseProgressDto> {
    assertCanReadStudentProgress(actor);
    await this.requireOrganization(actor.organizationId);

    const course = await this.prisma.course.findFirst({
      where: { id: courseId, organizationId: actor.organizationId },
      select: { id: true },
    });
    if (!course) {
      throw new NotFoundException(COURSE_NOT_FOUND_MESSAGE);
    }

    const student = await this.prisma.user.findFirst({
      where: {
        id: studentId,
        organizationId: actor.organizationId,
        role: UserRole.STUDENT,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundException(COURSE_STUDENT_NOT_FOUND_MESSAGE);
    }

    await this.requireStaffEnrollment(actor, courseId, studentId);
    return this.loadProgress(
      actor.organizationId,
      courseId,
      studentId,
      staffSessionScope(actor),
    );
  }

  /**
   * Повторна перевірка після FOR UPDATE: публікацію могли зняти між першим
   * читанням і блокуванням рядка курсу.
   */
  private async requireAssignedPublishedCourse(
    db: Prisma.TransactionClient | PrismaService,
    actor: User,
    courseId: string,
  ): Promise<void> {
    const access = await db.course.findFirst({
      where: { id: courseId, organizationId: actor.organizationId },
      select: { id: true, status: true, publicationStatus: true },
    });
    if (!access) {
      throw new NotFoundException(COURSE_NOT_FOUND_MESSAGE);
    }

    const enrollment = await db.enrollment.findFirst({
      where: {
        studentId: actor.id,
        status: EnrollmentStatus.ACTIVE,
        group: {
          organizationId: actor.organizationId,
          courseId,
        },
      },
      select: { id: true },
    });
    if (!enrollment) {
      throw new ForbiddenException('Insufficient permissions');
    }
    if (
      access.publicationStatus !== CoursePublicationStatus.PUBLISHED ||
      access.status !== CourseStatus.ACTIVE
    ) {
      throw new ForbiddenException(COURSE_NOT_PUBLISHED_MESSAGE);
    }
  }

  private async requireStaffEnrollment(
    actor: User,
    courseId: string,
    studentId: string,
  ): Promise<void> {
    if (actor.role === UserRole.TEACHER) {
      const ownGroup = await this.prisma.enrollment.findFirst({
        where: enrollmentWhere(
          actor.organizationId,
          courseId,
          studentId,
          actor.id,
        ),
        select: { id: true },
      });
      if (ownGroup) {
        return;
      }
    }

    const assigned = await this.prisma.enrollment.findFirst({
      where: enrollmentWhere(actor.organizationId, courseId, studentId),
      select: { id: true },
    });
    if (!assigned) {
      throw new NotFoundException(COURSE_PROGRESS_NOT_FOUND_MESSAGE);
    }
    if (actor.role === UserRole.TEACHER) {
      throw new ForbiddenException('Insufficient permissions');
    }
  }

  private loadProgress(
    organizationId: string,
    courseId: string,
    studentId: string,
    scope: SessionScope,
  ): Promise<CourseProgressDto> {
    return this.prisma.$transaction((tx) =>
      this.syncProgress(tx, organizationId, courseId, studentId, scope),
    );
  }

  /**
   * Пише проходження уроку. nextCycle задають, коли спроби тесту цього уроку вичерпано:
   * тоді починається новий цикл із нульовим лічильником, а історія спроб лишається.
   * Повтор без nextCycle нічого не змінює і не чіпає completedAt.
   */
  private async markCompleted(
    tx: Prisma.TransactionClient,
    actor: User,
    courseId: string,
    lessonId: string,
    nextCycle: number | null,
  ): Promise<void> {
    const existing = await tx.courseLessonCompletion.findUnique({
      where: { studentId_lessonId: { studentId: actor.id, lessonId } },
      select: { courseId: true, organizationId: true, testCycle: true },
    });
    if (existing) {
      if (
        existing.courseId !== courseId ||
        existing.organizationId !== actor.organizationId
      ) {
        throw new NotFoundException(LESSON_NOT_FOUND_MESSAGE);
      }
      if (nextCycle !== null && nextCycle > existing.testCycle) {
        await tx.courseLessonCompletion.update({
          where: { studentId_lessonId: { studentId: actor.id, lessonId } },
          data: { testCycle: nextCycle },
        });
      }
      return;
    }

    try {
      await tx.courseLessonCompletion.create({
        data: {
          organizationId: actor.organizationId,
          courseId,
          lessonId,
          studentId: actor.id,
          ...(nextCycle !== null ? { testCycle: nextCycle } : {}),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return;
      }
      throw error;
    }
  }

  /**
   * Відповідь завжди рахується з поточних уроків і проходжень.
   * Знімок у course_progress перезаписується, лише якщо він розійшовся
   * або студент уже має хоча б одне проходження.
   */
  private async syncProgress(
    tx: Prisma.TransactionClient,
    organizationId: string,
    courseId: string,
    studentId: string,
    scope: SessionScope,
  ): Promise<CourseProgressDto> {
    const lessons = await tx.courseLesson.findMany({
      where: {
        courseId,
        publicationStatus: CourseLessonPublicationStatus.PUBLISHED,
      },
      select: lessonProgressSelect,
    });
    const gate = await loadLessonGate(tx, organizationId, courseId, studentId);
    const completions =
      lessons.length === 0
        ? []
        : await tx.courseLessonCompletion.findMany({
            where: {
              organizationId,
              courseId,
              studentId,
              lessonId: { in: lessons.map((lesson) => lesson.id) },
            },
            select: { lessonId: true, completedAt: true },
          });
    const markedAtByLesson = new Map(
      completions.map((row) => [row.lessonId, row.completedAt]),
    );
    const passedAtByTest = await this.loadPassedAt(
      tx,
      organizationId,
      studentId,
      [...gate.testsByLesson.values()],
    );
    const completedAtByLesson = new Map<string, Date>();
    for (const lesson of lessons) {
      if (!gate.cleared.has(lesson.id)) {
        continue;
      }
      const testId = gate.testsByLesson.get(lesson.id);
      const clearedAt = testId
        ? passedAtByTest.get(testId)
        : markedAtByLesson.get(lesson.id);
      if (clearedAt) {
        completedAtByLesson.set(lesson.id, clearedAt);
      }
    }
    const completedLessonCount = lessons.filter((lesson) =>
      gate.cleared.has(lesson.id),
    ).length;
    const totalLessonCount = lessons.length;
    const percent = progressPercent(completedLessonCount, totalLessonCount);

    const snapshot = await tx.courseProgress.findUnique({
      where: { studentId_courseId: { studentId, courseId } },
      select: {
        organizationId: true,
        completedLessonCount: true,
        totalLessonCount: true,
        percent: true,
        updatedAt: true,
      },
    });
    const updatedAt = await this.persistSnapshot(tx, {
      organizationId,
      courseId,
      studentId,
      completedLessonCount,
      totalLessonCount,
      percent,
      snapshot,
    });
    const sessionsByLesson = await this.loadLinkedSessions(tx, {
      organizationId,
      courseId,
      studentId,
      courseLessonIds: lessons.map((lesson) => lesson.id),
      scope,
    });
    const test = await this.loadTest(tx, organizationId, courseId, studentId);

    return {
      courseId,
      studentId,
      completedLessonCount,
      totalLessonCount,
      percent,
      updatedAt,
      lessons: lessons
        .map((lesson) =>
          toLessonProgress(
            lesson,
            completedAtByLesson,
            sessionsByLesson.get(lesson.id) ?? [],
            gate,
          ),
        )
        .sort(byCourseOrder),
      test,
    };
  }

  /** Коли студент уперше склав кожен із цих тестів. Тест без PASSED у мапі відсутній. */
  private async loadPassedAt(
    tx: Prisma.TransactionClient,
    organizationId: string,
    studentId: string,
    testIds: string[],
  ): Promise<Map<string, Date>> {
    const passedAt = new Map<string, Date>();
    if (testIds.length === 0) {
      return passedAt;
    }
    const attempts = await tx.theoryTestAttempt.findMany({
      where: {
        organizationId,
        studentId,
        status: TheoryTestAttemptStatus.PASSED,
        testId: { in: testIds },
        submittedAt: { not: null },
      },
      select: { testId: true, submittedAt: true },
      orderBy: { submittedAt: 'asc' },
    });
    for (const attempt of attempts) {
      if (attempt.submittedAt && !passedAt.has(attempt.testId)) {
        passedAt.set(attempt.testId, attempt.submittedAt);
      }
    }
    return passedAt;
  }

  /** Очні заняття груп студента, прив’язані до уроків цього курсу, і його відмітка. */
  private async loadLinkedSessions(
    tx: Prisma.TransactionClient,
    input: {
      organizationId: string;
      courseId: string;
      studentId: string;
      courseLessonIds: string[];
      scope: SessionScope;
    },
  ): Promise<Map<string, LinkedTheorySessionDto[]>> {
    const grouped = new Map<string, LinkedTheorySessionDto[]>();
    if (input.courseLessonIds.length === 0) {
      return grouped;
    }
    const rows = await tx.lesson.findMany({
      where: {
        organizationId: input.organizationId,
        courseLessonId: { in: input.courseLessonIds },
        group: {
          organizationId: input.organizationId,
          courseId: input.courseId,
          ...(input.scope.teacherId
            ? { teacherId: input.scope.teacherId }
            : {}),
          enrollments: {
            some: {
              studentId: input.studentId,
              status: { in: input.scope.statuses },
            },
          },
        },
      },
      select: {
        id: true,
        topic: true,
        scheduledAt: true,
        durationMin: true,
        status: true,
        courseLessonId: true,
        attendances: {
          where: { studentId: input.studentId },
          select: { status: true },
        },
      },
      orderBy: { scheduledAt: 'asc' },
    });
    for (const row of rows) {
      if (!row.courseLessonId) {
        continue;
      }
      const session: LinkedTheorySessionDto = {
        lessonId: row.id,
        topic: row.topic,
        scheduledAt: row.scheduledAt,
        durationMin: row.durationMin,
        status: row.status,
        attendance: row.attendances[0]?.status ?? null,
      };
      const list = grouped.get(row.courseLessonId) ?? [];
      list.push(session);
      grouped.set(row.courseLessonId, list);
    }
    return grouped;
  }

  private async loadTest(
    tx: Prisma.TransactionClient,
    organizationId: string,
    courseId: string,
    studentId: string,
  ): Promise<TheoryTestResultDto | null> {
    const result = await tx.theoryTestResult.findUnique({
      where: { studentId_courseId: { studentId, courseId } },
      select: {
        id: true,
        organizationId: true,
        courseId: true,
        testId: true,
        studentId: true,
        status: true,
        score: true,
        takenAt: true,
      },
    });
    if (!result || result.organizationId !== organizationId) {
      return null;
    }
    return {
      id: result.id,
      courseId: result.courseId,
      testId: result.testId ?? null,
      studentId: result.studentId,
      status: result.status,
      score: result.score,
      takenAt: result.takenAt,
    };
  }

  private async persistSnapshot(
    tx: Prisma.TransactionClient,
    input: {
      organizationId: string;
      courseId: string;
      studentId: string;
      completedLessonCount: number;
      totalLessonCount: number;
      percent: number;
      snapshot: ProgressSnapshot | null;
    },
  ): Promise<Date | null> {
    const { snapshot } = input;
    if (
      snapshot &&
      snapshot.organizationId === input.organizationId &&
      snapshot.completedLessonCount === input.completedLessonCount &&
      snapshot.totalLessonCount === input.totalLessonCount &&
      snapshot.percent === input.percent
    ) {
      return snapshot.updatedAt;
    }
    if (!snapshot && input.completedLessonCount === 0) {
      return null;
    }

    const saved = await tx.courseProgress.upsert({
      where: {
        studentId_courseId: {
          studentId: input.studentId,
          courseId: input.courseId,
        },
      },
      create: {
        organizationId: input.organizationId,
        courseId: input.courseId,
        studentId: input.studentId,
        completedLessonCount: input.completedLessonCount,
        totalLessonCount: input.totalLessonCount,
        percent: input.percent,
      },
      update: {
        organizationId: input.organizationId,
        completedLessonCount: input.completedLessonCount,
        totalLessonCount: input.totalLessonCount,
        percent: input.percent,
      },
      select: { updatedAt: true },
    });
    return saved.updatedAt;
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

function toLessonProgress(
  lesson: LessonProgressRow,
  completedAtByLesson: Map<string, Date>,
  sessions: LinkedTheorySessionDto[],
  gate: Awaited<ReturnType<typeof loadLessonGate>>,
): CourseLessonProgressDto {
  const testState = gate.tests.get(lesson.id);
  return {
    lessonId: lesson.id,
    chapterId: lesson.chapterId,
    title: lesson.title,
    position: lesson.position,
    chapterPosition: lesson.chapter.position,
    completed: gate.cleared.has(lesson.id),
    completedAt: completedAtByLesson.get(lesson.id) ?? null,
    locked: gate.locked.has(lesson.id),
    passed: gate.passed.has(lesson.id),
    hasTest: gate.testsByLesson.has(lesson.id),
    test: testState ? toLessonTestProgress(testState) : null,
    retryMessage: gate.exhausted.has(lesson.id) ? LESSON_RETRY_MESSAGE : null,
    sessions,
  };
}

function byCourseOrder(
  left: CourseLessonProgressDto,
  right: CourseLessonProgressDto,
): number {
  return (
    left.chapterPosition - right.chapterPosition ||
    left.position - right.position ||
    left.lessonId.localeCompare(right.lessonId)
  );
}
