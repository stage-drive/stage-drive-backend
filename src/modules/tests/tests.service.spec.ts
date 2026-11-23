import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CoursePublicationStatus,
  CourseStatus,
  TheoryTestFormat,
  TheoryTestPublicationStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  COURSE_NOT_FOUND_MESSAGE,
  COURSE_NOT_PUBLISHED_MESSAGE,
} from '../courses/courses.service';
import {
  PUBLISH_QUESTIONS_REQUIRED_MESSAGE,
  SINGLE_EXCLUSIVE_MESSAGE,
} from './tests.rules';
import {
  NO_TEST_FIELDS_MESSAGE,
  PUBLISHED_LAST_QUESTION_MESSAGE,
  TEST_ARCHIVED_COURSE_MESSAGE,
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
  const questionRow = {
    id: 'question-1',
    testId: 'test-1',
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
    enrollment: { findFirst: jest.fn() },
    courseLesson: { findFirst: jest.fn() },
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

  it('rejects a teacher before reading the organization', async () => {
    const error = await caught(
      service.list({ ...admin, role: UserRole.TEACHER } as never),
    );
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
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
    prisma.theoryQuestion.findMany.mockResolvedValue([
      { options: [{ isCorrect: true }, { isCorrect: false }] },
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
});
