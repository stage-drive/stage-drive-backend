import {
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CoursePublicationStatus,
  CourseStatus,
  EnrollmentStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LESSON_NOT_FOUND_MESSAGE } from './course-structure.service';
import {
  COURSE_PROGRESS_NOT_FOUND_MESSAGE,
  COURSE_STUDENT_NOT_FOUND_MESSAGE,
  CourseProgressService,
  progressPercent,
} from './course-progress.service';
import {
  COURSE_NOT_FOUND_MESSAGE,
  COURSE_NOT_PUBLISHED_MESSAGE,
} from './courses.service';

async function caught(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('Expected the promise to reject');
}

const courseId = 'course-1';
const completedAt = new Date('2026-11-01T10:00:00.000Z');
const updatedAt = new Date('2026-11-07T10:00:00.000Z');

const signs = {
  id: 'lesson-signs',
  chapterId: 'chapter-1',
  title: 'Знаки',
  position: 2,
  chapter: { position: 1 },
};
const control = {
  id: 'lesson-control',
  chapterId: 'chapter-1',
  title: 'Регулювання',
  position: 1,
  chapter: { position: 1 },
};
const engine = {
  id: 'lesson-engine',
  chapterId: 'chapter-2',
  title: 'Двигун',
  position: 1,
  chapter: { position: 2 },
};
const lessons = [signs, engine, control];

describe('progressPercent', () => {
  it.each([
    [0, 0, 0],
    [0, 3, 0],
    [1, 0, 0],
    [1, 3, 33],
    [2, 3, 67],
    [1, 2, 50],
    [3, 3, 100],
  ])('rounds %i of %i to %i', (completed, total, percent) => {
    expect(progressPercent(completed, total)).toBe(percent);
  });
});

describe('CourseProgressService', () => {
  const student = {
    id: 'student-1',
    role: UserRole.STUDENT,
    organizationId: 'org-1',
  };
  const admin = {
    id: 'admin-1',
    role: UserRole.ADMIN,
    organizationId: 'org-1',
  };
  const teacher = {
    id: 'teacher-1',
    role: UserRole.TEACHER,
    organizationId: 'org-1',
  };
  const published = {
    id: courseId,
    status: CourseStatus.ACTIVE,
    publicationStatus: CoursePublicationStatus.PUBLISHED,
  };

  const prisma = {
    organization: { findUnique: jest.fn() },
    course: { findFirst: jest.fn() },
    enrollment: { findFirst: jest.fn() },
    user: { findFirst: jest.fn() },
    courseLesson: { findFirst: jest.fn(), findMany: jest.fn() },
    courseLessonCompletion: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    courseProgress: { findUnique: jest.fn(), upsert: jest.fn() },
    student: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };

  let service: CourseProgressService;
  let log: jest.SpyInstance;

  function executedQuery(): { text: string; values: unknown[] } {
    const [strings, ...values] = prisma.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const query = Prisma.sql(strings, ...values);
    return {
      text: query.text.replace(/\s+/g, ' ').trim(),
      values: query.values,
    };
  }

  function allowStudentCourse() {
    prisma.course.findFirst.mockResolvedValue(published);
    prisma.enrollment.findFirst.mockResolvedValue({
      id: 'enrollment-1',
      group: { courseId },
    });
  }

  function givenLessons() {
    prisma.courseLesson.findMany.mockResolvedValue(lessons);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      deletedAt: null,
    });
    prisma.course.findFirst.mockResolvedValue(null);
    prisma.enrollment.findFirst.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.courseLesson.findFirst.mockResolvedValue(null);
    prisma.courseLesson.findMany.mockResolvedValue([]);
    prisma.courseLessonCompletion.findUnique.mockResolvedValue(null);
    prisma.courseLessonCompletion.findMany.mockResolvedValue([]);
    prisma.courseLessonCompletion.create.mockResolvedValue({ id: 'done-1' });
    prisma.courseProgress.findUnique.mockResolvedValue(null);
    prisma.student.findUnique.mockResolvedValue(null);
    prisma.courseProgress.upsert.mockResolvedValue({ updatedAt });
    prisma.$queryRaw.mockResolvedValue([{ id: courseId }]);
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    service = new CourseProgressService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('student access', () => {
    it.each([
      UserRole.OWNER,
      UserRole.ADMIN,
      UserRole.TEACHER,
      UserRole.INSTRUCTOR,
    ])('forbids %s before touching the database', async (role) => {
      const actor = { ...student, role };

      await expect(
        service.getOwn(actor as never, courseId),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.getCurrent(actor as never)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        service.completeLesson(actor as never, courseId, signs.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.organization.findUnique).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns 404 when the organization is soft-deleted', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        deletedAt: new Date(),
      });

      const error = await caught(service.getOwn(student as never, courseId));

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe('Organization not found');
      expect(prisma.course.findFirst).not.toHaveBeenCalled();
    });

    it('returns 404 for a course outside the student organization', async () => {
      const error = await caught(
        service.getOwn(student as never, 'course-foreign'),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(COURSE_NOT_FOUND_MESSAGE);
      expect(prisma.enrollment.findFirst).not.toHaveBeenCalled();
      expect(prisma.course.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'course-foreign', organizationId: 'org-1' },
        }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a student who is not enrolled before revealing a draft', async () => {
      prisma.course.findFirst.mockResolvedValue({
        ...published,
        publicationStatus: CoursePublicationStatus.DRAFT,
      });

      const error = await caught(service.getOwn(student as never, courseId));

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.message).toBe('Insufficient permissions');
    });

    it('hides an assigned draft and an archived course', async () => {
      prisma.enrollment.findFirst.mockResolvedValue({ id: 'enrollment-1' });
      prisma.course.findFirst.mockResolvedValue({
        ...published,
        publicationStatus: CoursePublicationStatus.DRAFT,
      });

      const draft = await caught(service.getOwn(student as never, courseId));
      expect(draft.message).toBe(COURSE_NOT_PUBLISHED_MESSAGE);

      prisma.course.findFirst.mockResolvedValue({
        ...published,
        status: CourseStatus.ARCHIVED,
      });
      const archived = await caught(
        service.completeLesson(student as never, courseId, signs.id),
      );
      expect(archived.message).toBe(COURSE_NOT_PUBLISHED_MESSAGE);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns 404 when the student has no group with a course', async () => {
      const error = await caught(service.getCurrent(student as never));

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(COURSE_NOT_FOUND_MESSAGE);
      expect(prisma.course.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('reading own progress', () => {
    it('returns every lesson in course order and does not store an empty snapshot', async () => {
      allowStudentCourse();
      givenLessons();

      await expect(service.getOwn(student as never, courseId)).resolves.toEqual(
        {
          courseId,
          studentId: 'student-1',
          completedLessonCount: 0,
          totalLessonCount: 3,
          percent: 0,
          updatedAt: null,
          lessons: [
            {
              lessonId: control.id,
              chapterId: control.chapterId,
              title: control.title,
              position: 1,
              chapterPosition: 1,
              completed: false,
              completedAt: null,
            },
            {
              lessonId: signs.id,
              chapterId: signs.chapterId,
              title: signs.title,
              position: 2,
              chapterPosition: 1,
              completed: false,
              completedAt: null,
            },
            {
              lessonId: engine.id,
              chapterId: engine.chapterId,
              title: engine.title,
              position: 1,
              chapterPosition: 2,
              completed: false,
              completedAt: null,
            },
          ],
        },
      );
      expect(prisma.courseProgress.upsert).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('reads the published course of the latest active enrollment', async () => {
      allowStudentCourse();

      await expect(service.getCurrent(student as never)).resolves.toMatchObject(
        {
          courseId,
          studentId: 'student-1',
          percent: 0,
          updatedAt: null,
        },
      );
      expect(prisma.enrollment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            studentId: 'student-1',
            status: EnrollmentStatus.ACTIVE,
            group: {
              organizationId: 'org-1',
              courseId: { not: null },
            },
          },
          orderBy: { enrolledAt: 'desc' },
        }),
      );
    });

    it('refreshes a stored snapshot when the course gained a lesson', async () => {
      allowStudentCourse();
      givenLessons();
      prisma.courseLessonCompletion.findMany.mockResolvedValue([
        { lessonId: signs.id, completedAt },
      ]);
      prisma.courseProgress.findUnique.mockResolvedValue({
        organizationId: 'org-1',
        completedLessonCount: 1,
        totalLessonCount: 2,
        percent: 50,
        updatedAt: new Date('2026-10-01T00:00:00.000Z'),
      });

      const result = await service.getOwn(student as never, courseId);

      expect(result).toMatchObject({
        completedLessonCount: 1,
        totalLessonCount: 3,
        percent: 33,
        updatedAt,
      });
      expect(
        result.lessons.find((lesson) => lesson.lessonId === signs.id),
      ).toEqual(expect.objectContaining({ completed: true, completedAt }));
      expect(prisma.courseProgress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            organizationId: 'org-1',
            courseId,
            studentId: 'student-1',
            completedLessonCount: 1,
            totalLessonCount: 3,
            percent: 33,
          }),
        }),
      );
    });

    it('keeps the stored timestamp when the snapshot is already current', async () => {
      allowStudentCourse();
      givenLessons();
      prisma.courseLessonCompletion.findMany.mockResolvedValue([
        { lessonId: signs.id, completedAt },
      ]);
      prisma.courseProgress.findUnique.mockResolvedValue({
        organizationId: 'org-1',
        completedLessonCount: 1,
        totalLessonCount: 3,
        percent: 33,
        updatedAt,
      });

      await expect(
        service.getOwn(student as never, courseId),
      ).resolves.toMatchObject({ updatedAt, percent: 33 });
      expect(prisma.courseProgress.upsert).not.toHaveBeenCalled();
    });
  });

  describe('completing a lesson', () => {
    it('stores the completion and the recalculated progress', async () => {
      allowStudentCourse();
      givenLessons();
      prisma.courseLesson.findFirst.mockResolvedValue({ id: signs.id });
      prisma.courseLessonCompletion.findMany.mockResolvedValue([
        { lessonId: signs.id, completedAt },
      ]);

      const result = await service.completeLesson(
        student as never,
        courseId,
        signs.id,
      );

      expect(prisma.courseLessonCompletion.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          courseId,
          lessonId: signs.id,
          studentId: 'student-1',
        },
      });
      expect(result).toMatchObject({
        completedLessonCount: 1,
        totalLessonCount: 3,
        percent: 33,
        updatedAt,
      });
      expect(log).toHaveBeenCalledWith(
        'Course progress saved courseId=course-1 lessonId=lesson-signs studentId=student-1 completedLessonCount=1 totalLessonCount=3 percent=33 organizationId=org-1 actorId=student-1',
      );
      const query = executedQuery();
      expect(query.text).toContain('FOR UPDATE');
      expect(query.text).toContain('organization_id');
      expect(query.values).toEqual([courseId, 'org-1']);
    });

    it('does not create a second row when the lesson was already completed', async () => {
      allowStudentCourse();
      givenLessons();
      prisma.courseLesson.findFirst.mockResolvedValue({ id: signs.id });
      prisma.courseLessonCompletion.findUnique.mockResolvedValue({
        courseId,
        organizationId: 'org-1',
      });
      prisma.courseLessonCompletion.findMany.mockResolvedValue([
        { lessonId: signs.id, completedAt },
      ]);
      prisma.courseProgress.findUnique.mockResolvedValue({
        organizationId: 'org-1',
        completedLessonCount: 1,
        totalLessonCount: 3,
        percent: 33,
        updatedAt,
      });

      const result = await service.completeLesson(
        student as never,
        courseId,
        signs.id,
      );

      expect(prisma.courseLessonCompletion.create).not.toHaveBeenCalled();
      expect(prisma.courseProgress.upsert).not.toHaveBeenCalled();
      expect(result.completedLessonCount).toBe(1);
      expect(
        result.lessons.find((lesson) => lesson.lessonId === signs.id)
          ?.completedAt,
      ).toEqual(completedAt);
    });

    it('recalculates after another lesson of the same course', async () => {
      allowStudentCourse();
      givenLessons();
      prisma.courseLesson.findFirst.mockResolvedValue({ id: control.id });
      prisma.courseLessonCompletion.findMany.mockResolvedValue([
        { lessonId: signs.id, completedAt },
        { lessonId: control.id, completedAt },
      ]);

      await expect(
        service.completeLesson(student as never, courseId, control.id),
      ).resolves.toMatchObject({
        completedLessonCount: 2,
        totalLessonCount: 3,
        percent: 67,
      });
    });

    it('returns 404 when the lesson is not in this course', async () => {
      allowStudentCourse();

      const error = await caught(
        service.completeLesson(student as never, courseId, 'lesson-foreign'),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(LESSON_NOT_FOUND_MESSAGE);
      expect(prisma.courseLessonCompletion.create).not.toHaveBeenCalled();
      expect(prisma.courseProgress.upsert).not.toHaveBeenCalled();
    });

    it('returns 404 when the locked course is not in this organization', async () => {
      allowStudentCourse();
      prisma.courseLesson.findFirst.mockResolvedValue({ id: signs.id });
      prisma.$queryRaw.mockResolvedValue([]);

      const error = await caught(
        service.completeLesson(student as never, courseId, signs.id),
      );

      expect(error.message).toBe(COURSE_NOT_FOUND_MESSAGE);
      expect(prisma.courseLessonCompletion.create).not.toHaveBeenCalled();
    });

    it('treats a concurrent unique conflict as the lesson already saved', async () => {
      allowStudentCourse();
      givenLessons();
      prisma.courseLesson.findFirst.mockResolvedValue({ id: signs.id });
      prisma.courseLessonCompletion.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.9.1',
        }),
      );
      prisma.courseLessonCompletion.findMany.mockResolvedValue([
        { lessonId: signs.id, completedAt },
      ]);

      await expect(
        service.completeLesson(student as never, courseId, signs.id),
      ).resolves.toMatchObject({ completedLessonCount: 1, percent: 33 });
    });

    it('does not count a completion stored for another organization', async () => {
      allowStudentCourse();
      givenLessons();

      await service.getOwn(student as never, courseId);

      expect(prisma.courseLessonCompletion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-1',
            courseId,
            studentId: 'student-1',
          }),
        }),
      );
    });
  });

  describe('staff access', () => {
    const enrolled = {
      studentId: 'student-1',
      status: {
        in: [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED],
      },
      group: { organizationId: 'org-1', courseId },
    };

    function allowStaffStudent() {
      prisma.course.findFirst.mockResolvedValue({ id: courseId });
      prisma.user.findFirst.mockResolvedValue({ id: 'student-1' });
    }

    it.each([UserRole.OWNER, UserRole.INSTRUCTOR, UserRole.STUDENT])(
      'forbids %s before touching the database',
      async (role) => {
        const actor = { ...admin, role };

        await expect(
          service.getForStudent(actor as never, courseId, 'student-1'),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.organization.findUnique).not.toHaveBeenCalled();
      },
    );

    it('returns 404 for a course of another organization', async () => {
      const error = await caught(
        service.getForStudent(admin as never, 'course-foreign', 'student-1'),
      );

      expect(error.message).toBe(COURSE_NOT_FOUND_MESSAGE);
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(prisma.course.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'course-foreign', organizationId: 'org-1' },
        }),
      );
    });

    it('returns 404 for a student of another organization', async () => {
      prisma.course.findFirst.mockResolvedValue({ id: courseId });

      const error = await caught(
        service.getForStudent(admin as never, courseId, 'foreign-student'),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(COURSE_STUDENT_NOT_FOUND_MESSAGE);
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'foreign-student',
          organizationId: 'org-1',
          role: UserRole.STUDENT,
          deletedAt: null,
        },
        select: { id: true },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns 404 when the student is not enrolled on this course', async () => {
      allowStaffStudent();

      const error = await caught(
        service.getForStudent(admin as never, courseId, 'student-1'),
      );

      expect(error.message).toBe(COURSE_PROGRESS_NOT_FOUND_MESSAGE);
      expect(prisma.enrollment.findFirst).toHaveBeenCalledWith({
        where: enrolled,
        select: { id: true },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('lets ADMIN read progress of an enrolled student in the same school', async () => {
      allowStaffStudent();
      prisma.enrollment.findFirst.mockResolvedValue({ id: 'enrollment-1' });
      givenLessons();
      prisma.courseLessonCompletion.findMany.mockResolvedValue([
        { lessonId: signs.id, completedAt },
      ]);

      await expect(
        service.getForStudent(admin as never, courseId, 'student-1'),
      ).resolves.toMatchObject({
        courseId,
        studentId: 'student-1',
        completedLessonCount: 1,
        percent: 33,
      });
    });

    it('lets TEACHER read only a student of their own group', async () => {
      allowStaffStudent();
      givenLessons();
      prisma.enrollment.findFirst.mockImplementation(
        (args: { where: { group?: { teacherId?: string } } }) =>
          Promise.resolve(
            args.where.group?.teacherId === 'teacher-1'
              ? { id: 'enrollment-1' }
              : null,
          ),
      );

      await expect(
        service.getForStudent(teacher as never, courseId, 'student-1'),
      ).resolves.toMatchObject({ studentId: 'student-1', percent: 0 });
      expect(prisma.enrollment.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.enrollment.findFirst).toHaveBeenCalledWith({
        where: {
          ...enrolled,
          group: { ...enrolled.group, teacherId: 'teacher-1' },
        },
        select: { id: true },
      });
    });

    it('forbids TEACHER to read a student of another teacher on the same course', async () => {
      allowStaffStudent();
      prisma.enrollment.findFirst.mockImplementation(
        (args: { where: { group?: { teacherId?: string } } }) =>
          Promise.resolve(args.where.group?.teacherId ? null : { id: 'other' }),
      );

      const error = await caught(
        service.getForStudent(teacher as never, courseId, 'student-1'),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.message).toBe('Insufficient permissions');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
