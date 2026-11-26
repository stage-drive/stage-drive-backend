import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CourseLessonPublicationStatus,
  CoursePublicationStatus,
  CourseStatus,
  TheoryTestAttemptStatus,
  TheoryTestFormat,
  TheoryTestPublicationStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LESSON_NOT_FOUND_MESSAGE } from '../courses/course-structure.service';
import {
  LESSON_LOCKED_MESSAGE,
  LESSON_RETRY_MESSAGE,
} from '../courses/lesson-gate';
import {
  COURSE_NOT_FOUND_MESSAGE,
  COURSE_NOT_PUBLISHED_MESSAGE,
} from '../courses/courses.service';
import {
  MULTIPLE_CORRECT_REQUIRED_MESSAGE,
  PUBLISH_LESSON_REQUIRED_MESSAGE,
  PUBLISH_MAX_ATTEMPTS_MESSAGE,
  PUBLISH_NAME_REQUIRED_MESSAGE,
  PUBLISH_PASSING_SCORE_MESSAGE,
  PUBLISH_QUESTIONS_REQUIRED_MESSAGE,
  SINGLE_EXCLUSIVE_MESSAGE,
} from './tests.rules';
import {
  LESSON_COURSE_MISMATCH_MESSAGE,
  LESSON_REQUIRED_MESSAGE,
  LESSON_TEST_ATTEMPTS_MESSAGE,
  LESSON_TEST_EXISTS_MESSAGE,
  LESSON_TEST_NOT_FOUND_MESSAGE,
  NO_TEST_FIELDS_MESSAGE,
  PUBLISHED_LAST_QUESTION_MESSAGE,
  PUBLISHED_LESSON_KEEPS_TEST_MESSAGE,
  TEST_ARCHIVED_COURSE_MESSAGE,
  TEST_ARCHIVED_MESSAGE,
  TEST_NAME_TAKEN_MESSAGE,
  TEST_NOT_FOUND_MESSAGE,
  TEST_NOT_PUBLISHED_MESSAGE,
  TestsService,
} from './tests.service';

async function caught(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('Expected the promise to reject');
}

describe('TestsService', () => {
  const admin = {
    id: 'admin-1',
    role: UserRole.ADMIN,
    organizationId: 'org-1',
  };
  const student = {
    id: 'student-1',
    role: UserRole.STUDENT,
    organizationId: 'org-1',
  };
  const createdAt = new Date('2026-11-18T10:00:00.000Z');
  const updatedAt = new Date('2026-11-18T11:00:00.000Z');
  const testRow = {
    id: 'test-1',
    courseId: 'course-1',
    courseLessonId: null as string | null,
    name: 'ПДР, категорія B',
    description: 'Підсумковий тест.',
    format: TheoryTestFormat.SINGLE_CHOICE,
    passingScore: 90,
    timeLimitMinutes: 20,
    maxAttempts: null as number | null,
    shuffleQuestions: false,
    publicationStatus:
      TheoryTestPublicationStatus.DRAFT as TheoryTestPublicationStatus,
    createdAt,
    updatedAt,
  };
  /** Тест, який уже прив’язано до уроку з 3 спробами: його можна публікувати. */
  const lessonTestRow = {
    ...testRow,
    courseLessonId: 'lesson-1' as string | null,
    maxAttempts: 3 as number | null,
  };
  const questionRow = {
    id: 'question-1',
    testId: 'test-1',
    type: TheoryTestFormat.SINGLE_CHOICE as TheoryTestFormat,
    text: 'Що означає цей знак?',
    position: 1,
    createdAt,
    updatedAt,
    options: [
      {
        id: 'option-1',
        questionId: 'question-1',
        text: 'Поступитися',
        isCorrect: false,
        position: 1,
        createdAt,
        updatedAt,
      },
      {
        id: 'option-2',
        questionId: 'question-1',
        text: 'Проїхати першим',
        isCorrect: true,
        position: 2,
        createdAt,
        updatedAt,
      },
    ],
  };

  let nameDuplicate: { id: string } | null = null;
  let currentTest: typeof testRow | null = testRow;

  const prisma = {
    organization: { findUnique: jest.fn() },
    course: { findFirst: jest.fn() },
    theoryTest: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    theoryQuestion: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    theoryAnswerOption: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    theoryTestAttempt: { findMany: jest.fn(), updateMany: jest.fn() },
    courseLessonCompletion: { findMany: jest.fn() },
    enrollment: { findFirst: jest.fn() },
    group: { findFirst: jest.fn() },
    courseLesson: { findFirst: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };

  let service: TestsService;
  let log: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    nameDuplicate = null;
    currentTest = testRow;
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      deletedAt: null,
    });
    prisma.course.findFirst.mockResolvedValue({
      id: 'course-1',
      status: CourseStatus.ACTIVE,
    });
    prisma.theoryTest.findMany.mockResolvedValue([]);
    prisma.theoryTest.findFirst.mockImplementation(
      (args: { where?: { name?: unknown; courseLessonId?: unknown } }) =>
        Promise.resolve(
          args.where?.courseLessonId
            ? null
            : args.where?.name
              ? nameDuplicate
              : currentTest,
        ),
    );
    prisma.courseLesson.findFirst.mockResolvedValue(null);
    prisma.courseLesson.findMany.mockResolvedValue([]);
    prisma.courseLessonCompletion.findMany.mockResolvedValue([]);
    prisma.theoryTestAttempt.findMany.mockResolvedValue([]);
    prisma.theoryTestAttempt.updateMany.mockResolvedValue({ count: 0 });
    prisma.theoryTest.create.mockImplementation(
      ({ data }: { data: typeof testRow }) =>
        Promise.resolve({ ...testRow, ...data, id: 'test-1' }),
    );
    prisma.theoryTest.update.mockImplementation(
      ({ data }: { data: Partial<typeof testRow> }) =>
        Promise.resolve({ ...currentTest, ...data }),
    );
    prisma.theoryQuestion.findMany.mockResolvedValue([]);
    prisma.theoryQuestion.findFirst.mockResolvedValue(questionRow);
    prisma.theoryQuestion.create.mockResolvedValue({
      ...questionRow,
      options: [],
    });
    prisma.theoryQuestion.delete.mockResolvedValue(questionRow);
    prisma.enrollment.findFirst.mockResolvedValue({
      id: 'enrollment-1',
      group: { courseId: 'course-1' },
    });
    prisma.group.findFirst.mockResolvedValue({ id: 'group-1' });
    prisma.theoryAnswerOption.updateMany.mockResolvedValue({ count: 1 });
    prisma.theoryAnswerOption.update.mockImplementation(
      ({ data }: { data: { isCorrect?: boolean; text?: string } }) =>
        Promise.resolve({ ...questionRow.options[0], ...data }),
    );
    prisma.$queryRaw.mockResolvedValue([{ id: 'test-1' }]);
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    service = new TestsService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    log.mockRestore();
  });

  it('lists tests of the teacher groups and can filter them by course', async () => {
    const teacher = { ...admin, id: 'teacher-1', role: UserRole.TEACHER };

    await service.list(teacher as never);
    expect(prisma.theoryTest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'org-1',
          course: {
            groups: {
              some: { teacherId: 'teacher-1', organizationId: 'org-1' },
            },
          },
        },
      }),
    );

    await service.list(teacher as never, { courseId: 'course-1' });
    expect(prisma.theoryTest.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1', courseId: 'course-1' },
      }),
    );
    expect(prisma.group.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        teacherId: 'teacher-1',
        courseId: 'course-1',
      },
      select: { id: true },
    });
  });

  it('rejects a teacher reading tests of a course outside their groups', async () => {
    const teacher = { ...admin, id: 'teacher-1', role: UserRole.TEACHER };
    prisma.group.findFirst.mockResolvedValue(null);

    const listed = await caught(
      service.list(teacher as never, { courseId: 'course-1' }),
    );
    const opened = await caught(service.get(teacher as never, 'test-1'));
    const created = await caught(
      service.create(teacher as never, {
        courseId: 'course-1',
        name: 'ПДР',
        format: TheoryTestFormat.SINGLE_CHOICE,
        passingScore: 80,
      }),
    );

    expect(listed).toBeInstanceOf(ForbiddenException);
    expect(opened).toBeInstanceOf(ForbiddenException);
    expect(created).toBeInstanceOf(ForbiddenException);
    expect(prisma.theoryTest.findMany).not.toHaveBeenCalled();
    expect(prisma.theoryTest.create).not.toHaveBeenCalled();
  });

  it('hides tests of a deleted organization', async () => {
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      deletedAt: new Date(),
    });
    const error = await caught(service.list(admin as never));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(prisma.theoryTest.findMany).not.toHaveBeenCalled();
  });

  it('lists only tests of the actor organization', async () => {
    await service.list(admin as never);
    expect(prisma.theoryTest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1' },
      }),
    );
  });

  it('creates a draft in the actor organization and not from the body', async () => {
    const created = await service.create(admin as never, {
      courseId: 'course-1',
      name: 'ПДР, категорія B',
      format: TheoryTestFormat.SINGLE_CHOICE,
      passingScore: 90,
    });

    expect(created.publicationStatus).toBe(TheoryTestPublicationStatus.DRAFT);
    expect(prisma.theoryTest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          courseId: 'course-1',
          name: 'ПДР, категорія B',
          format: TheoryTestFormat.SINGLE_CHOICE,
          passingScore: 90,
          publicationStatus: TheoryTestPublicationStatus.DRAFT,
        }),
      }),
    );
  });

  it('creates a lesson test with exactly 3 attempts', async () => {
    prisma.courseLesson.findFirst.mockResolvedValue({ id: 'lesson-1' });

    const created = await service.createForLesson(
      admin as never,
      'course-1',
      'chapter-1',
      'lesson-1',
      {
        name: 'Тест знаків',
        format: TheoryTestFormat.SINGLE_CHOICE,
        passingScore: 80,
      },
    );

    expect(created.courseLessonId).toBe('lesson-1');
    expect(created.maxAttempts).toBe(3);
    expect(prisma.theoryTest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          courseId: 'course-1',
          courseLessonId: 'lesson-1',
          maxAttempts: 3,
          publicationStatus: TheoryTestPublicationStatus.DRAFT,
        }),
      }),
    );
  });

  it('returns 404 when the course belongs to another organization', async () => {
    prisma.course.findFirst.mockResolvedValue(null);
    const error = await caught(
      service.create(admin as never, {
        courseId: 'course-foreign',
        name: 'Чужий',
        format: TheoryTestFormat.SINGLE_CHOICE,
        passingScore: 80,
      }),
    );
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe(COURSE_NOT_FOUND_MESSAGE);
    expect(prisma.theoryTest.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate test name in the same organization', async () => {
    nameDuplicate = { id: 'test-2' };
    const error = await caught(
      service.create(admin as never, {
        courseId: 'course-1',
        name: 'ПДР, категорія B',
        format: TheoryTestFormat.TRUE_FALSE,
        passingScore: 70,
      }),
    );
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toEqual({
      statusCode: 409,
      errors: [{ field: 'name', message: TEST_NAME_TAKEN_MESSAGE }],
    });
  });

  it('rejects an empty test update', async () => {
    const error = await caught(service.update(admin as never, 'test-1', {}));
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toEqual({
      statusCode: 400,
      errors: [{ field: 'body', message: NO_TEST_FIELDS_MESSAGE }],
    });
  });

  it('returns 404 for a test of another organization', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    const error = await caught(
      service.update(admin as never, 'test-foreign', { name: 'Інша назва' }),
    );
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe(TEST_NOT_FOUND_MESSAGE);
  });

  it('stores a renamed test', async () => {
    const updated = await service.update(admin as never, 'test-1', {
      name: 'ПДР, вечірня група',
      passingScore: 85,
    });
    expect(updated.name).toBe('ПДР, вечірня група');
    expect(updated.passingScore).toBe(85);
  });

  it('rejects publication when the test has no questions', async () => {
    currentTest = lessonTestRow;
    const error = await caught(
      service.changePublication(admin as never, 'test-1', {
        publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
      }),
    );
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toEqual({
      statusCode: 400,
      errors: [
        { field: 'questions', message: PUBLISH_QUESTIONS_REQUIRED_MESSAGE },
      ],
    });
    expect(prisma.theoryTest.update).not.toHaveBeenCalled();
  });

  it('publishes a test whose questions match the format', async () => {
    currentTest = lessonTestRow;
    prisma.theoryQuestion.findMany.mockResolvedValue([
      {
        type: TheoryTestFormat.SINGLE_CHOICE,
        options: [{ isCorrect: true }, { isCorrect: false }],
      },
    ]);
    const published = await service.changePublication(
      admin as never,
      'test-1',
      {
        publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
      },
    );
    expect(published.publicationStatus).toBe(
      TheoryTestPublicationStatus.PUBLISHED,
    );
  });

  it('does not publish a test of an archived course', async () => {
    prisma.course.findFirst.mockResolvedValue({
      id: 'course-1',
      status: CourseStatus.ARCHIVED,
    });
    const error = await caught(
      service.changePublication(admin as never, 'test-1', {
        publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
      }),
    );
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(TEST_ARCHIVED_COURSE_MESSAGE);
  });

  it('rejects two correct answers while the draft is still single-choice', async () => {
    const error = await caught(
      service.createQuestion(admin as never, 'test-1', {
        text: 'Що означає цей знак?',
        options: [
          { text: 'Так', isCorrect: true },
          { text: 'Ні', isCorrect: true },
        ],
      }),
    );
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toEqual({
      statusCode: 400,
      errors: [{ field: 'options', message: SINGLE_EXCLUSIVE_MESSAGE }],
    });
    expect(prisma.theoryQuestion.create).not.toHaveBeenCalled();
  });

  it('does not delete the last question of a published test', async () => {
    currentTest = {
      ...testRow,
      publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
    };
    prisma.theoryQuestion.findMany.mockResolvedValue([
      { id: 'question-1', position: 1 },
    ]);
    const error = await caught(
      service.deleteQuestion(admin as never, 'test-1', 'question-1'),
    );
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toEqual({
      statusCode: 400,
      errors: [
        { field: 'questions', message: PUBLISHED_LAST_QUESTION_MESSAGE },
      ],
    });
    expect(prisma.theoryQuestion.delete).not.toHaveBeenCalled();
  });

  it('does not let a student read the admin test with correct answers', async () => {
    const error = await caught(service.get(student as never, 'test-1'));
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(prisma.theoryTest.findFirst).not.toHaveBeenCalled();
  });

  it('returns only published tests of the student course', async () => {
    prisma.course.findFirst.mockResolvedValue({
      id: 'course-1',
      status: CourseStatus.ACTIVE,
      publicationStatus: CoursePublicationStatus.PUBLISHED,
    });
    prisma.theoryTest.findMany.mockResolvedValue([
      {
        ...testRow,
        publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
        _count: { questions: 1 },
      },
    ]);

    const listed = await service.listCurrent(student as never);

    expect(listed.courseId).toBe('course-1');
    expect(listed.tests).toEqual([
      expect.objectContaining({
        id: 'test-1',
        publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
        questionCount: 1,
      }),
    ]);
    expect(prisma.theoryTest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'org-1',
          courseId: 'course-1',
          publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
        },
      }),
    );
  });

  it('hides the current course tests when the student has no group', async () => {
    prisma.enrollment.findFirst.mockResolvedValue(null);
    const error = await caught(service.listCurrent(student as never));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe(COURSE_NOT_FOUND_MESSAGE);
    expect(prisma.theoryTest.findMany).not.toHaveBeenCalled();
  });

  it('hides tests when the assigned course is not published', async () => {
    prisma.course.findFirst.mockResolvedValue({
      id: 'course-1',
      status: CourseStatus.ACTIVE,
      publicationStatus: CoursePublicationStatus.DRAFT,
    });
    const error = await caught(service.listCurrent(student as never));
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.message).toBe(COURSE_NOT_PUBLISHED_MESSAGE);
    expect(prisma.theoryTest.findMany).not.toHaveBeenCalled();
  });

  it('returns a published test without correct answers', async () => {
    currentTest = {
      ...testRow,
      publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
      questions: [questionRow],
    } as typeof testRow;
    prisma.course.findFirst.mockResolvedValue({
      id: 'course-1',
      status: CourseStatus.ACTIVE,
      publicationStatus: CoursePublicationStatus.PUBLISHED,
    });

    const content = await service.getContent(student as never, 'test-1');

    expect(content.publicationStatus).toBe(
      TheoryTestPublicationStatus.PUBLISHED,
    );
    expect(content.questions[0]?.options[0]).toMatchObject({
      id: 'option-1',
      text: 'Поступитися',
    });
    expect(JSON.stringify(content)).not.toContain('"isCorrect"');
    expect(prisma.theoryTest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'test-1', organizationId: 'org-1' },
      }),
    );
  });

  it('does not open a draft test to the student', async () => {
    prisma.course.findFirst.mockResolvedValue({
      id: 'course-1',
      status: CourseStatus.ACTIVE,
      publicationStatus: CoursePublicationStatus.PUBLISHED,
    });
    const error = await caught(service.getContent(student as never, 'test-1'));
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.message).toBe(TEST_NOT_PUBLISHED_MESSAGE);
  });

  it('does not open a test of another organization', async () => {
    currentTest = null;
    const error = await caught(
      service.getContent(student as never, 'test-foreign'),
    );
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe(TEST_NOT_FOUND_MESSAGE);
  });

  it('does not open a published test of a course the student is not enrolled in', async () => {
    currentTest = {
      ...testRow,
      publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
      questions: [questionRow],
    } as typeof testRow;
    prisma.course.findFirst.mockResolvedValue({
      id: 'course-1',
      status: CourseStatus.ACTIVE,
      publicationStatus: CoursePublicationStatus.PUBLISHED,
    });
    prisma.enrollment.findFirst.mockResolvedValue(null);

    const error = await caught(service.getContent(student as never, 'test-1'));

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.message).toBe('Insufficient permissions');
  });

  it('keeps a single correct answer when another option is marked', async () => {
    await service.updateOption(
      admin as never,
      'test-1',
      'question-1',
      'option-1',
      { isCorrect: true },
    );
    expect(prisma.theoryAnswerOption.updateMany).toHaveBeenCalledWith({
      where: { questionId: 'question-1', NOT: { id: 'option-1' } },
      data: { isCorrect: false },
    });
    expect(prisma.theoryAnswerOption.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'option-1' },
        data: expect.objectContaining({ isCorrect: true }),
      }),
    );
  });

  describe('listing by lesson and status', () => {
    it('filters by lesson and publication status within the actor organization', async () => {
      prisma.courseLesson.findFirst.mockResolvedValue({
        id: 'lesson-1',
        courseId: 'course-1',
      });

      await service.list(admin as never, {
        lessonId: 'lesson-1',
        publicationStatus: TheoryTestPublicationStatus.ARCHIVED,
      });

      expect(prisma.courseLesson.findFirst).toHaveBeenCalledWith({
        where: { id: 'lesson-1', course: { organizationId: 'org-1' } },
        select: { id: true, courseId: true },
      });
      expect(prisma.theoryTest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org-1',
            courseLessonId: 'lesson-1',
            publicationStatus: TheoryTestPublicationStatus.ARCHIVED,
            courseId: 'course-1',
          },
        }),
      );
    });

    it('answers 404 for a lesson of another organization', async () => {
      const error = await caught(
        service.list(admin as never, { lessonId: 'lesson-foreign' }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(LESSON_NOT_FOUND_MESSAGE);
      expect(prisma.theoryTest.findMany).not.toHaveBeenCalled();
    });

    it('returns nothing when the lesson belongs to a different course than courseId', async () => {
      prisma.courseLesson.findFirst.mockResolvedValue({
        id: 'lesson-1',
        courseId: 'course-2',
      });

      await expect(
        service.list(admin as never, {
          lessonId: 'lesson-1',
          courseId: 'course-1',
        }),
      ).resolves.toEqual({ tests: [] });
      expect(prisma.theoryTest.findMany).not.toHaveBeenCalled();
    });

    it('keeps a teacher out of lessons of courses outside their groups', async () => {
      const teacher = { ...admin, id: 'teacher-1', role: UserRole.TEACHER };
      prisma.courseLesson.findFirst.mockResolvedValue({
        id: 'lesson-1',
        courseId: 'course-1',
      });
      prisma.group.findFirst.mockResolvedValue(null);

      const error = await caught(
        service.list(teacher as never, { lessonId: 'lesson-1' }),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(prisma.theoryTest.findMany).not.toHaveBeenCalled();
    });
  });

  describe('creating a test for a lesson', () => {
    beforeEach(() => {
      prisma.courseLesson.findFirst.mockResolvedValue({
        id: 'lesson-1',
        courseId: 'course-1',
      });
    });

    it('takes the course from the lesson and fixes the attempts at 3', async () => {
      const created = await service.create(admin as never, {
        lessonId: 'lesson-1',
        name: 'Тест знаків',
        passingScore: 80,
      });

      expect(created).toMatchObject({
        courseLessonId: 'lesson-1',
        courseId: 'course-1',
        maxAttempts: 3,
        publicationStatus: TheoryTestPublicationStatus.DRAFT,
      });
      expect(prisma.theoryTest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: 'org-1',
            courseId: 'course-1',
            courseLessonId: 'lesson-1',
            maxAttempts: 3,
          }),
        }),
      );
    });

    it('rejects an attempts limit other than 3 for a lesson test', async () => {
      const error = await caught(
        service.create(admin as never, {
          lessonId: 'lesson-1',
          name: 'Тест знаків',
          passingScore: 80,
          maxAttempts: 5,
        }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [
          { field: 'maxAttempts', message: LESSON_TEST_ATTEMPTS_MESSAGE },
        ],
      });
      expect(prisma.theoryTest.create).not.toHaveBeenCalled();
    });

    it('rejects a courseId that is not the course of the lesson', async () => {
      const error = await caught(
        service.create(admin as never, {
          lessonId: 'lesson-1',
          courseId: 'course-2',
          name: 'Тест знаків',
          passingScore: 80,
        }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [
          { field: 'courseId', message: LESSON_COURSE_MISMATCH_MESSAGE },
        ],
      });
      expect(prisma.theoryTest.create).not.toHaveBeenCalled();
    });

    it('rejects a second test while the lesson still has a draft or a published one', async () => {
      prisma.theoryTest.findFirst.mockResolvedValueOnce({ id: 'test-2' });

      const error = await caught(
        service.create(admin as never, {
          lessonId: 'lesson-1',
          name: 'Інший тест',
          passingScore: 80,
        }),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(LESSON_TEST_EXISTS_MESSAGE);
      expect(prisma.theoryTest.findFirst).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          courseLessonId: 'lesson-1',
          publicationStatus: { not: TheoryTestPublicationStatus.ARCHIVED },
        },
        select: { id: true },
      });
      expect(prisma.theoryTest.create).not.toHaveBeenCalled();
    });

    it('answers 404 for a lesson of another organization', async () => {
      prisma.courseLesson.findFirst.mockResolvedValue(null);

      const error = await caught(
        service.create(admin as never, {
          lessonId: 'lesson-foreign',
          name: 'Чужий',
          passingScore: 80,
        }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(LESSON_NOT_FOUND_MESSAGE);
      expect(prisma.theoryTest.create).not.toHaveBeenCalled();
    });

    it('asks for a lesson when neither lessonId nor courseId is given', async () => {
      const error = await caught(
        service.create(admin as never, {
          name: 'Без уроку',
          passingScore: 80,
        }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'lessonId', message: LESSON_REQUIRED_MESSAGE }],
      });
      expect(prisma.theoryTest.create).not.toHaveBeenCalled();
    });
  });

  describe('moving a test to a lesson', () => {
    it('binds a draft to a lesson of its course and fixes the attempts at 3', async () => {
      prisma.courseLesson.findFirst.mockResolvedValue({ id: 'lesson-1' });

      await service.update(admin as never, 'test-1', { lessonId: 'lesson-1' });

      expect(prisma.theoryTest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'test-1' },
          data: { courseLessonId: 'lesson-1', maxAttempts: 3 },
        }),
      );
    });

    it('does not let a published test jump to another lesson', async () => {
      currentTest = {
        ...lessonTestRow,
        publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
      };

      const error = await caught(
        service.update(admin as never, 'test-1', { lessonId: 'lesson-2' }),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(prisma.theoryTest.update).not.toHaveBeenCalled();
    });

    it('does not let a lesson test leave the attempts limit of 3', async () => {
      currentTest = lessonTestRow;

      const error = await caught(
        service.update(admin as never, 'test-1', { maxAttempts: 10 }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [
          { field: 'maxAttempts', message: LESSON_TEST_ATTEMPTS_MESSAGE },
        ],
      });
      expect(prisma.theoryTest.update).not.toHaveBeenCalled();
    });

    it('does not let the attempts limit sneak in together with the lesson', async () => {
      prisma.courseLesson.findFirst.mockResolvedValue({ id: 'lesson-1' });

      const error = await caught(
        service.update(admin as never, 'test-1', {
          lessonId: 'lesson-1',
          maxAttempts: 10,
        }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(prisma.theoryTest.update).not.toHaveBeenCalled();
    });
  });

  describe('publishing (UC-003)', () => {
    const publish = () =>
      service.changePublication(admin as never, 'test-1', {
        publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
      });

    it('refuses a test that is not bound to a lesson and has no attempts limit', async () => {
      currentTest = testRow;
      prisma.theoryQuestion.findMany.mockResolvedValue([
        {
          type: TheoryTestFormat.SINGLE_CHOICE,
          options: [{ isCorrect: true }, { isCorrect: false }],
        },
      ]);

      const error = await caught(publish());

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [
          { field: 'lessonId', message: PUBLISH_LESSON_REQUIRED_MESSAGE },
          { field: 'maxAttempts', message: PUBLISH_MAX_ATTEMPTS_MESSAGE },
        ],
      });
      expect(prisma.theoryTest.update).not.toHaveBeenCalled();
    });

    it('reports every problem of the test at once', async () => {
      currentTest = {
        ...testRow,
        name: '   ',
        passingScore: 0,
      };

      const error = await caught(publish());

      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [
          { field: 'name', message: PUBLISH_NAME_REQUIRED_MESSAGE },
          { field: 'lessonId', message: PUBLISH_LESSON_REQUIRED_MESSAGE },
          { field: 'passingScore', message: PUBLISH_PASSING_SCORE_MESSAGE },
          { field: 'maxAttempts', message: PUBLISH_MAX_ATTEMPTS_MESSAGE },
          {
            field: 'questions',
            message: PUBLISH_QUESTIONS_REQUIRED_MESSAGE,
          },
        ],
      });
    });

    it('points at the exact question that breaks its own type', async () => {
      currentTest = lessonTestRow;
      prisma.theoryQuestion.findMany.mockResolvedValue([
        {
          type: TheoryTestFormat.SINGLE_CHOICE,
          options: [{ isCorrect: true }, { isCorrect: false }],
        },
        {
          type: TheoryTestFormat.MULTIPLE_CHOICE,
          options: [{ isCorrect: false }, { isCorrect: false }],
        },
      ]);

      const error = await caught(publish());

      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [
          {
            field: 'questions[1].options',
            message: MULTIPLE_CORRECT_REQUIRED_MESSAGE,
          },
        ],
      });
    });

    it('publishes a lesson test whose questions each match their own type', async () => {
      currentTest = lessonTestRow;
      prisma.theoryQuestion.findMany.mockResolvedValue([
        {
          type: TheoryTestFormat.SINGLE_CHOICE,
          options: [{ isCorrect: true }, { isCorrect: false }],
        },
        {
          type: TheoryTestFormat.MULTIPLE_CHOICE,
          options: [
            { isCorrect: true },
            { isCorrect: true },
            { isCorrect: false },
          ],
        },
        {
          type: TheoryTestFormat.TRUE_FALSE,
          options: [{ isCorrect: false }, { isCorrect: true }],
        },
      ]);

      await expect(publish()).resolves.toMatchObject({
        publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
      });
      expect(log).toHaveBeenCalledWith(
        'Test publication changed testId=test-1 publicationStatus=PUBLISHED organizationId=org-1 actorId=admin-1',
      );
    });

    it('does not publish an archived test', async () => {
      currentTest = {
        ...lessonTestRow,
        publicationStatus: TheoryTestPublicationStatus.ARCHIVED,
      };

      const error = await caught(publish());

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(TEST_ARCHIVED_MESSAGE);
      expect(prisma.theoryTest.update).not.toHaveBeenCalled();
    });

    it('refuses to unpublish the test of a published lesson', async () => {
      currentTest = {
        ...lessonTestRow,
        publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
      };
      prisma.courseLesson.findFirst.mockResolvedValue({
        publicationStatus: CourseLessonPublicationStatus.PUBLISHED,
      });

      const error = await caught(
        service.changePublication(admin as never, 'test-1', {
          publicationStatus: TheoryTestPublicationStatus.DRAFT,
        }),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(PUBLISHED_LESSON_KEEPS_TEST_MESSAGE);
      expect(prisma.theoryTest.update).not.toHaveBeenCalled();
    });

    it('takes a published test back to a draft without validating it again', async () => {
      currentTest = {
        ...lessonTestRow,
        publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
      };

      await expect(
        service.changePublication(admin as never, 'test-1', {
          publicationStatus: TheoryTestPublicationStatus.DRAFT,
        }),
      ).resolves.toMatchObject({
        publicationStatus: TheoryTestPublicationStatus.DRAFT,
      });
      expect(prisma.theoryQuestion.findMany).not.toHaveBeenCalled();
    });

    it('does nothing when the test already has the requested status', async () => {
      currentTest = {
        ...lessonTestRow,
        publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
      };

      await service.changePublication(admin as never, 'test-1', {
        publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
      });

      expect(prisma.theoryTest.update).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    });
  });

  describe('archiving', () => {
    const published = () => ({
      ...lessonTestRow,
      publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
    });

    it('refuses to archive the published test of a published lesson', async () => {
      currentTest = published();
      prisma.courseLesson.findFirst.mockResolvedValue({
        publicationStatus: CourseLessonPublicationStatus.PUBLISHED,
      });

      const error = await caught(service.archive(admin as never, 'test-1'));

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(PUBLISHED_LESSON_KEEPS_TEST_MESSAGE);
      expect(prisma.theoryTest.update).not.toHaveBeenCalled();
    });

    it('archives the test and closes its open attempts as EXPIRED', async () => {
      currentTest = published();

      await expect(
        service.archive(admin as never, 'test-1'),
      ).resolves.toMatchObject({
        id: 'test-1',
        publicationStatus: TheoryTestPublicationStatus.ARCHIVED,
      });

      expect(prisma.theoryTestAttempt.updateMany).toHaveBeenCalledWith({
        where: {
          testId: 'test-1',
          status: TheoryTestAttemptStatus.IN_PROGRESS,
        },
        data: {
          status: TheoryTestAttemptStatus.EXPIRED,
          submittedAt: expect.any(Date),
        },
      });
      expect(prisma.theoryTest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'test-1' },
          data: { publicationStatus: TheoryTestPublicationStatus.ARCHIVED },
        }),
      );
      expect(log).toHaveBeenCalledWith(
        'Test archived testId=test-1 organizationId=org-1 actorId=admin-1',
      );
    });

    it('archives a draft too', async () => {
      currentTest = lessonTestRow;

      await expect(
        service.archive(admin as never, 'test-1'),
      ).resolves.toMatchObject({
        publicationStatus: TheoryTestPublicationStatus.ARCHIVED,
      });
    });

    it('changes nothing when the test is already archived', async () => {
      currentTest = {
        ...lessonTestRow,
        publicationStatus: TheoryTestPublicationStatus.ARCHIVED,
      };

      await expect(
        service.archive(admin as never, 'test-1'),
      ).resolves.toMatchObject({
        publicationStatus: TheoryTestPublicationStatus.ARCHIVED,
      });
      expect(prisma.theoryTestAttempt.updateMany).not.toHaveBeenCalled();
      expect(prisma.theoryTest.update).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    });

    it('answers 404 for a test of another organization', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const error = await caught(service.archive(admin as never, 'test-x'));

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(TEST_NOT_FOUND_MESSAGE);
      expect(prisma.theoryTest.update).not.toHaveBeenCalled();
    });

    it('keeps a teacher whose groups do not have the course from archiving it', async () => {
      const teacher = { ...admin, id: 'teacher-1', role: UserRole.TEACHER };
      currentTest = published();
      prisma.group.findFirst.mockResolvedValue(null);

      const error = await caught(service.archive(teacher as never, 'test-1'));

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(prisma.theoryTestAttempt.updateMany).not.toHaveBeenCalled();
      expect(prisma.theoryTest.update).not.toHaveBeenCalled();
    });

    it('keeps a student from archiving', async () => {
      const error = await caught(service.archive(student as never, 'test-1'));

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    });

    it.each([
      [
        'renaming it',
        (svc: TestsService) =>
          svc.update(admin as never, 'test-1', { name: 'Нова назва' }),
      ],
      [
        'adding a question',
        (svc: TestsService) =>
          svc.createQuestion(admin as never, 'test-1', { text: 'Питання' }),
      ],
      [
        'editing a question',
        (svc: TestsService) =>
          svc.updateQuestion(admin as never, 'test-1', 'question-1', {
            text: 'Інший текст',
          }),
      ],
      [
        'deleting a question',
        (svc: TestsService) =>
          svc.deleteQuestion(admin as never, 'test-1', 'question-1'),
      ],
      [
        'adding an option',
        (svc: TestsService) =>
          svc.createOption(admin as never, 'test-1', 'question-1', {
            text: 'Варіант',
            isCorrect: false,
          }),
      ],
      [
        'editing an option',
        (svc: TestsService) =>
          svc.updateOption(admin as never, 'test-1', 'question-1', 'option-1', {
            text: 'Інший варіант',
          }),
      ],
      [
        'deleting an option',
        (svc: TestsService) =>
          svc.deleteOption(admin as never, 'test-1', 'question-1', 'option-1'),
      ],
    ])('keeps an archived test read-only: %s', async (_name, action) => {
      currentTest = {
        ...lessonTestRow,
        publicationStatus: TheoryTestPublicationStatus.ARCHIVED,
      };

      const error = await caught(action(service));

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(TEST_ARCHIVED_MESSAGE);
      expect(prisma.theoryTest.update).not.toHaveBeenCalled();
      expect(prisma.theoryQuestion.create).not.toHaveBeenCalled();
      expect(prisma.theoryQuestion.update).not.toHaveBeenCalled();
      expect(prisma.theoryQuestion.delete).not.toHaveBeenCalled();
      expect(prisma.theoryAnswerOption.create).not.toHaveBeenCalled();
      expect(prisma.theoryAnswerOption.update).not.toHaveBeenCalled();
      expect(prisma.theoryAnswerOption.delete).not.toHaveBeenCalled();
    });
  });

  describe('the lesson test for a student', () => {
    const detail = () =>
      ({
        ...lessonTestRow,
        publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
        questions: [questionRow],
      }) as never;
    const gateLessons = [
      { id: 'lesson-1', position: 1, chapter: { position: 1 } },
      { id: 'lesson-2', position: 2, chapter: { position: 1 } },
    ];
    const attemptRow = (status: TheoryTestAttemptStatus, index = 1) => ({
      id: `attempt-${index}`,
      testId: 'test-1',
      status,
      cycle: 1,
      expiresAt: null,
    });

    function givenGate(attempts: ReturnType<typeof attemptRow>[] = []) {
      prisma.courseLesson.findMany.mockResolvedValue(gateLessons);
      prisma.theoryTest.findMany.mockResolvedValue([
        { id: 'test-1', courseLessonId: 'lesson-1', maxAttempts: 3 },
      ]);
      prisma.theoryTestAttempt.findMany.mockResolvedValue(attempts);
    }

    function givenOpenLesson(lessonId = 'lesson-1') {
      prisma.courseLesson.findFirst.mockResolvedValue({
        id: lessonId,
        courseId: 'course-1',
        publicationStatus: CourseLessonPublicationStatus.PUBLISHED,
      });
    }

    beforeEach(() => {
      prisma.course.findFirst.mockResolvedValue({
        id: 'course-1',
        status: CourseStatus.ACTIVE,
        publicationStatus: CoursePublicationStatus.PUBLISHED,
      });
      givenOpenLesson();
      givenGate();
    });

    it('returns the published test with the attempt counters and without correct answers', async () => {
      prisma.theoryTest.findFirst.mockResolvedValueOnce(detail());
      givenGate([attemptRow(TheoryTestAttemptStatus.FAILED)]);

      const result = await service.getLessonTest(student as never, 'lesson-1');

      expect(result).toMatchObject({
        id: 'test-1',
        lessonId: 'lesson-1',
        courseId: 'course-1',
        status: TheoryTestPublicationStatus.PUBLISHED,
        maxAttempts: 3,
        passed: false,
        attemptsUsed: 1,
        attemptsLeft: 2,
        openAttemptId: null,
        nextAttemptAvailable: true,
        lockedNextUntilPassed: true,
        questionCount: 1,
      });
      expect(result.questions[0]).toMatchObject({
        id: 'question-1',
        type: TheoryTestFormat.SINGLE_CHOICE,
      });
      expect(JSON.stringify(result)).not.toContain('isCorrect');
      expect(prisma.theoryTest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org-1',
            courseLessonId: 'lesson-1',
            publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
          },
        }),
      );
    });

    it('unlocks the next lesson in the answer once the test is passed', async () => {
      prisma.theoryTest.findFirst.mockResolvedValueOnce(detail());
      givenGate([attemptRow(TheoryTestAttemptStatus.PASSED)]);

      await expect(
        service.getLessonTest(student as never, 'lesson-1'),
      ).resolves.toMatchObject({
        passed: true,
        nextAttemptAvailable: false,
        lockedNextUntilPassed: false,
      });
    });

    it('asks to pass the lesson again once all 3 attempts are spent', async () => {
      prisma.theoryTest.findFirst.mockResolvedValueOnce(detail());
      givenGate([
        attemptRow(TheoryTestAttemptStatus.FAILED, 1),
        attemptRow(TheoryTestAttemptStatus.FAILED, 2),
        attemptRow(TheoryTestAttemptStatus.EXPIRED, 3),
      ]);

      const result = await service.getLessonTest(student as never, 'lesson-1');

      expect(result).toMatchObject({
        attemptsUsed: 3,
        attemptsLeft: 0,
        nextAttemptAvailable: false,
        message: LESSON_RETRY_MESSAGE,
      });
    });

    it('keeps a lesson closed while the test of the previous one is not passed', async () => {
      givenOpenLesson('lesson-2');
      givenGate([attemptRow(TheoryTestAttemptStatus.FAILED)]);

      const error = await caught(
        service.getLessonTest(student as never, 'lesson-2'),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.message).toBe(LESSON_LOCKED_MESSAGE);
    });

    it('answers 404 when the lesson has no published test', async () => {
      prisma.theoryTest.findMany.mockResolvedValue([]);
      prisma.theoryTest.findFirst.mockResolvedValue(null);

      const error = await caught(
        service.getLessonTest(student as never, 'lesson-1'),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(LESSON_TEST_NOT_FOUND_MESSAGE);
    });

    it('answers 404 for a lesson of another organization', async () => {
      prisma.courseLesson.findFirst.mockResolvedValue(null);

      const error = await caught(
        service.getLessonTest(student as never, 'lesson-foreign'),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(LESSON_NOT_FOUND_MESSAGE);
      expect(prisma.theoryTest.findFirst).not.toHaveBeenCalled();
    });

    it('keeps a lesson that is not published closed', async () => {
      prisma.courseLesson.findFirst.mockResolvedValue({
        id: 'lesson-1',
        courseId: 'course-1',
        publicationStatus: CourseLessonPublicationStatus.DRAFT,
      });

      const error = await caught(
        service.getLessonTest(student as never, 'lesson-1'),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.message).toBe(LESSON_LOCKED_MESSAGE);
    });

    it('requires an active enrollment in a group with this course', async () => {
      prisma.enrollment.findFirst.mockResolvedValue(null);

      const error = await caught(
        service.getLessonTest(student as never, 'lesson-1'),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.message).toBe('Insufficient permissions');
    });

    it('does not open the course of an unpublished program', async () => {
      prisma.course.findFirst.mockResolvedValue({
        id: 'course-1',
        status: CourseStatus.ACTIVE,
        publicationStatus: CoursePublicationStatus.DRAFT,
      });

      const error = await caught(
        service.getLessonTest(student as never, 'lesson-1'),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.message).toBe(COURSE_NOT_PUBLISHED_MESSAGE);
    });

    it.each([
      UserRole.ADMIN,
      UserRole.TEACHER,
      UserRole.INSTRUCTOR,
      UserRole.OWNER,
    ])(
      'is only for students: forbids %s before touching the database',
      async (role) => {
        const error = await caught(
          service.getLessonTest({ ...student, role } as never, 'lesson-1'),
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(prisma.organization.findUnique).not.toHaveBeenCalled();
      },
    );
  });
});
