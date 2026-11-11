import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CoursePublicationStatus,
  CourseStatus,
  EnrollmentStatus,
  Prisma,
  User,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CourseLessonProgressDto,
  CourseProgressDto,
  SubmitTheoryTestDto,
  TheoryTestResultDto,
} from './course-progress.dto';
import { LESSON_NOT_FOUND_MESSAGE } from './course-structure.service';
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
    await this.requireAssignedPublishedCourse(actor, courseId);
    return this.loadProgress(actor.organizationId, courseId, actor.id);
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
    await this.requireAssignedPublishedCourse(actor, courseId);
    return this.loadProgress(actor.organizationId, courseId, actor.id);
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
    await this.requireAssignedPublishedCourse(actor, courseId);

    const progress = await this.prisma.$transaction(async (tx) => {
      await lockCourse(tx, courseId, actor.organizationId);
      const lesson = await tx.courseLesson.findFirst({
        where: { id: lessonId, courseId },
        select: { id: true },
      });
      if (!lesson) {
        throw new NotFoundException(LESSON_NOT_FOUND_MESSAGE);
      }
      await this.markCompleted(tx, actor, courseId, lessonId);
      const progress = await this.syncProgress(
        tx,
        actor.organizationId,
        courseId,
        actor.id,
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
   * Зберігає актуальний результат тесту курсу і, якщо всі уроки вже пройдені
   * і результат PASSED, переводить навчальний статус в THEORY_COMPLETED.
   */
  async submitTest(
    actor: User,
    courseId: string,
    payload: SubmitTheoryTestDto,
  ): Promise<TheoryTestResultDto> {
    assertStudent(actor);
    await this.requireOrganization(actor.organizationId);
    await this.requireAssignedPublishedCourse(actor, courseId);

    const saved = await this.prisma.$transaction(async (tx) => {
      await lockCourse(tx, courseId, actor.organizationId);
      const result = await tx.theoryTestResult.upsert({
        where: { studentId_courseId: { studentId: actor.id, courseId } },
        create: {
          organizationId: actor.organizationId,
          courseId,
          studentId: actor.id,
          status: payload.status,
          score: payload.score ?? null,
        },
        update: {
          status: payload.status,
          score: payload.score ?? null,
          takenAt: new Date(),
        },
        select: {
          id: true,
          courseId: true,
          studentId: true,
          status: true,
          score: true,
          takenAt: true,
        },
      });
      await syncTheoryCompletion(tx, actor.id, actor.organizationId);
      return result;
    });

    this.logger.log(
      `Theory test saved courseId=${courseId} studentId=${actor.id} status=${saved.status} organizationId=${actor.organizationId}`,
    );
    return saved;
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
    return this.loadProgress(actor.organizationId, courseId, studentId);
  }

  private async requireAssignedPublishedCourse(
    actor: User,
    courseId: string,
  ): Promise<void> {
    const access = await this.prisma.course.findFirst({
      where: { id: courseId, organizationId: actor.organizationId },
      select: { id: true, status: true, publicationStatus: true },
    });
    if (!access) {
      throw new NotFoundException(COURSE_NOT_FOUND_MESSAGE);
    }

    const enrollment = await this.prisma.enrollment.findFirst({
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
  ): Promise<CourseProgressDto> {
    return this.prisma.$transaction((tx) =>
      this.syncProgress(tx, organizationId, courseId, studentId),
    );
  }

  private async markCompleted(
    tx: Prisma.TransactionClient,
    actor: User,
    courseId: string,
    lessonId: string,
  ): Promise<void> {
    const existing = await tx.courseLessonCompletion.findUnique({
      where: { studentId_lessonId: { studentId: actor.id, lessonId } },
      select: { courseId: true, organizationId: true },
    });
    if (existing) {
      if (
        existing.courseId !== courseId ||
        existing.organizationId !== actor.organizationId
      ) {
        throw new NotFoundException(LESSON_NOT_FOUND_MESSAGE);
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
  ): Promise<CourseProgressDto> {
    const lessons = await tx.courseLesson.findMany({
      where: { courseId },
      select: lessonProgressSelect,
    });
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
    const completedAtByLesson = new Map(
      completions.map((row) => [row.lessonId, row.completedAt]),
    );
    const completedLessonCount = lessons.filter((lesson) =>
      completedAtByLesson.has(lesson.id),
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

    return {
      courseId,
      studentId,
      completedLessonCount,
      totalLessonCount,
      percent,
      updatedAt,
      lessons: lessons
        .map((lesson) => toLessonProgress(lesson, completedAtByLesson))
        .sort(byCourseOrder),
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
): CourseLessonProgressDto {
  return {
    lessonId: lesson.id,
    chapterId: lesson.chapterId,
    title: lesson.title,
    position: lesson.position,
    chapterPosition: lesson.chapter.position,
    completed: completedAtByLesson.has(lesson.id),
    completedAt: completedAtByLesson.get(lesson.id) ?? null,
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
