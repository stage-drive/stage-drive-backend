import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CoursePublicationStatus,
  CourseStatus,
  TheoryTestAttemptStatus,
  TheoryTestFormat,
  TheoryTestPublicationStatus,
  TheoryTestStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { COURSE_NOT_PUBLISHED_MESSAGE } from '../courses/courses.service';
import {
  ATTEMPT_IN_PROGRESS_MESSAGE,
  ATTEMPT_NOT_FOUND_MESSAGE,
  ATTEMPT_NO_QUESTIONS_MESSAGE,
  TestAttemptsService,
} from './test-attempts.service';
import {
  TEST_NOT_FOUND_MESSAGE,
  TEST_NOT_PUBLISHED_MESSAGE,
} from './tests.service';

async function caught(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('Expected the promise to reject');
}

describe('TestAttemptsService', () => {
  const now = new Date('2026-11-21T12:00:00.000Z');
  const student = {
    id: 'student-1',
    role: UserRole.STUDENT,
    organizationId: 'org-1',
  };
  const publishedCourse = {
    id: 'course-1',
    status: CourseStatus.ACTIVE,
    publicationStatus: CoursePublicationStatus.PUBLISHED,
  };

  function catalog(overrides: Record<string, unknown> = {}) {
    return {
      id: 'test-1',
      courseId: 'course-1',
      format: TheoryTestFormat.SINGLE_CHOICE,
      passingScore: 90,
      timeLimitMinutes: 20 as number | null,
      shuffleQuestions: false,
      publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
      questions: [
        {
          id: 'question-1',
          text: 'Що означає цей знак?',
          position: 1,
          options: [
            { id: 'option-1', text: 'Ні', isCorrect: false, position: 1 },
            { id: 'option-2', text: 'Так', isCorrect: true, position: 2 },
          ],
        },
        {
          id: 'question-2',
          text: 'Друге питання?',
          position: 2,
          options: [
            { id: 'option-3', text: 'А', isCorrect: true, position: 1 },
            { id: 'option-4', text: 'Б', isCorrect: false, position: 2 },
          ],
        },
      ],
      ...overrides,
    };
  }

  function snapshot(
    status: TheoryTestAttemptStatus = TheoryTestAttemptStatus.IN_PROGRESS,
    score: number | null = null,
  ) {
    const graded =
      status === TheoryTestAttemptStatus.PASSED ||
      status === TheoryTestAttemptStatus.FAILED;
    return {
      id: 'attempt-1',
      testId: 'test-1',
      courseId: 'course-1',
      studentId: 'student-1',
      status,
      format: TheoryTestFormat.SINGLE_CHOICE,
      startedAt: now,
      expiresAt: new Date('2026-11-21T12:20:00.000Z'),
      submittedAt: status === TheoryTestAttemptStatus.IN_PROGRESS ? null : now,
      score,
      passingScore: 90,
      timeLimitMinutes: 20 as number | null,
      questions: [
        {
          id: 'snap-q-1',
          sourceQuestionId: 'question-1',
          text: 'Що означає цей знак?',
          position: 1,
          options: [
            {
              id: 'snap-o-1',
              sourceOptionId: 'option-1',
              text: 'Ні',
              position: 1,
              isCorrect: false,
            },
            {
              id: 'snap-o-2',
              sourceOptionId: 'option-2',
              text: 'Так',
              position: 2,
              isCorrect: true,
            },
          ],
          answers: graded ? [{ selections: [{ optionId: 'snap-o-2' }] }] : [],
        },
      ],
    };
  }

  let testRow: ReturnType<typeof catalog> | null = catalog();
  let openAttempt: { id: string; expiresAt: Date | null } | null = null;
  let currentAttempt: ReturnType<typeof snapshot> | null = null;

  const prisma = {
    organization: { findUnique: jest.fn() },
    course: { findFirst: jest.fn() },
    enrollment: { findFirst: jest.fn() },
    theoryTest: { findFirst: jest.fn() },
    theoryTestAttempt: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    theoryTestAttemptAnswer: { create: jest.fn() },
    theoryTestResult: { upsert: jest.fn() },
    student: { findUnique: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };

  let service: TestAttemptsService;
  let log: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    jest.clearAllMocks();
    testRow = catalog();
    openAttempt = null;
    currentAttempt = snapshot();
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      deletedAt: null,
    });
    prisma.course.findFirst.mockResolvedValue(publishedCourse);
    prisma.enrollment.findFirst.mockResolvedValue({ id: 'enrollment-1' });
    prisma.theoryTest.findFirst.mockImplementation(() =>
      Promise.resolve(testRow),
    );
    prisma.theoryTestAttempt.findFirst.mockImplementation(
      (args: { where?: { status?: TheoryTestAttemptStatus } }) =>
        Promise.resolve(
          args.where?.status === TheoryTestAttemptStatus.IN_PROGRESS
            ? openAttempt
            : currentAttempt,
        ),
    );
    prisma.theoryTestAttempt.create.mockImplementation(
      ({
        data,
      }: {
        data: { expiresAt: Date | null; timeLimitMinutes: number | null };
      }) =>
        Promise.resolve({
          ...snapshot(),
          expiresAt: data.expiresAt,
          timeLimitMinutes: data.timeLimitMinutes,
        }),
    );
    prisma.theoryTestAttempt.update.mockImplementation(
      ({ data }: { data: { status?: TheoryTestAttemptStatus } }) => {
        const base = currentAttempt ?? snapshot();
        const status = data.status ?? base.status;
        const graded =
          status === TheoryTestAttemptStatus.PASSED ||
          status === TheoryTestAttemptStatus.FAILED;
        return Promise.resolve({
          ...base,
          ...data,
          questions: base.questions.map((question) => ({
            ...question,
            answers: graded
              ? [{ selections: [{ optionId: 'snap-o-2' }] }]
              : question.answers,
          })),
        });
      },
    );
    prisma.theoryTestAttemptAnswer.create.mockResolvedValue({ id: 'answer-1' });
    prisma.theoryTestResult.upsert.mockResolvedValue({ id: 'result-1' });
    prisma.student.findUnique.mockResolvedValue(null);
    prisma.$queryRaw.mockResolvedValue([{ id: 'attempt-1' }]);
    prisma.$executeRaw.mockResolvedValue(0);
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    service = new TestAttemptsService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    log.mockRestore();
    jest.useRealTimers();
  });

  it('rejects a teacher before reading the organization', async () => {
    const error = await caught(
      service.start({ ...student, role: UserRole.TEACHER } as never, 'test-1'),
    );
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
  });

  it('hides a test of a deleted organization', async () => {
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      deletedAt: now,
    });
    const error = await caught(service.start(student as never, 'test-1'));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(prisma.theoryTest.findFirst).not.toHaveBeenCalled();
  });

  it('creates a separate attempt with the student, test, start time and deadline', async () => {
    const started = await service.start(student as never, 'test-1');
    const data = prisma.theoryTestAttempt.create.mock.calls[0][0].data;

    expect(prisma.$executeRaw.mock.calls[0][1]).toBe(
      'test-attempt:student-1:test-1',
    );
    expect(data).toMatchObject({
      organizationId: 'org-1',
      courseId: 'course-1',
      testId: 'test-1',
      studentId: 'student-1',
      status: TheoryTestAttemptStatus.IN_PROGRESS,
      passingScore: 90,
      timeLimitMinutes: 20,
      startedAt: now,
      expiresAt: new Date('2026-11-21T12:20:00.000Z'),
    });
    expect(data.questions.create[0].options.create[1]).toMatchObject({
      sourceOptionId: 'option-2',
      isCorrect: true,
    });
    expect(started).toMatchObject({
      id: 'attempt-1',
      studentId: 'student-1',
      testId: 'test-1',
      status: TheoryTestAttemptStatus.IN_PROGRESS,
      startedAt: now,
      score: null,
    });
    expect(started.questions[0].id).toBe('question-1');
    expect(started.questions[0].options[1]).toEqual({
      id: 'option-2',
      text: 'Так',
      position: 2,
    });
    expect(JSON.stringify(started)).not.toContain('isCorrect');
  });

  it('stores no deadline when the test does not limit time', async () => {
    testRow = catalog({ timeLimitMinutes: null });
    const started = await service.start(student as never, 'test-1');
    expect(started.expiresAt).toBeNull();
    expect(started.timeLimitMinutes).toBeNull();
  });

  it('fixes a shuffled question order on the attempt', async () => {
    testRow = catalog({ shuffleQuestions: true });
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    try {
      await service.start(student as never, 'test-1');
    } finally {
      random.mockRestore();
    }
    const created =
      prisma.theoryTestAttempt.create.mock.calls[0][0].data.questions.create;
    expect(
      created.map(
        (question: { sourceQuestionId: string }) => question.sourceQuestionId,
      ),
    ).toEqual(['question-2', 'question-1']);
    expect(
      created.map((question: { position: number }) => question.position),
    ).toEqual([1, 2]);
  });

  it('creates another row after the previous attempt is finished', async () => {
    await service.start(student as never, 'test-1');
    await service.start(student as never, 'test-1');
    expect(prisma.theoryTestAttempt.create).toHaveBeenCalledTimes(2);
  });

  it('does not open a second attempt while the current one is still running', async () => {
    openAttempt = {
      id: 'attempt-open',
      expiresAt: new Date('2026-11-21T12:20:00.000Z'),
    };
    const error = await caught(service.start(student as never, 'test-1'));
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toEqual({
      statusCode: 409,
      message: ATTEMPT_IN_PROGRESS_MESSAGE,
      attemptId: 'attempt-open',
    });
    expect(prisma.theoryTestAttempt.create).not.toHaveBeenCalled();
  });

  it('closes an expired open attempt and then starts a new one', async () => {
    openAttempt = {
      id: 'attempt-old',
      expiresAt: new Date('2026-11-21T11:59:59.000Z'),
    };
    await service.start(student as never, 'test-1');
    expect(prisma.theoryTestAttempt.update).toHaveBeenCalledWith({
      where: { id: 'attempt-old' },
      data: {
        status: TheoryTestAttemptStatus.EXPIRED,
        submittedAt: now,
      },
    });
    expect(prisma.theoryTestAttempt.create).toHaveBeenCalledTimes(1);
  });

  it('returns 404 for a missing test and 403 when the student cannot take it', async () => {
    testRow = null;
    const missing = await caught(service.start(student as never, 'test-1'));
    expect(missing).toBeInstanceOf(NotFoundException);
    expect(missing.message).toBe(TEST_NOT_FOUND_MESSAGE);

    testRow = catalog({
      publicationStatus: TheoryTestPublicationStatus.DRAFT,
    });
    const draft = await caught(service.start(student as never, 'test-1'));
    expect(draft).toBeInstanceOf(ForbiddenException);
    expect(draft.message).toBe(TEST_NOT_PUBLISHED_MESSAGE);

    testRow = catalog();
    prisma.enrollment.findFirst.mockResolvedValue(null);
    const denied = await caught(service.start(student as never, 'test-1'));
    expect(denied).toBeInstanceOf(ForbiddenException);

    prisma.enrollment.findFirst.mockResolvedValue({ id: 'enrollment-1' });
    prisma.course.findFirst.mockResolvedValue({
      ...publishedCourse,
      publicationStatus: CoursePublicationStatus.DRAFT,
    });
    const unpublished = await caught(service.start(student as never, 'test-1'));
    expect(unpublished).toBeInstanceOf(ForbiddenException);
    expect(unpublished.message).toBe(COURSE_NOT_PUBLISHED_MESSAGE);
    expect(prisma.theoryTestAttempt.create).not.toHaveBeenCalled();
  });

  it('refuses to start a test that has no questions', async () => {
    testRow = catalog({ questions: [] });
    const error = await caught(service.start(student as never, 'test-1'));
    expect(error.getResponse()).toEqual({
      statusCode: 400,
      errors: [{ field: 'questions', message: ATTEMPT_NO_QUESTIONS_MESSAGE }],
    });
  });

  it('returns attempt questions without correct answers while time remains', async () => {
    const view = await service.get(student as never, 'test-1', 'attempt-1');
    expect(view.questions[0].options[0]).toEqual({
      id: 'option-1',
      text: 'Ні',
      position: 1,
    });
    expect(view).not.toHaveProperty('questions.0.options.0.isCorrect');
    expect(JSON.stringify(view)).not.toContain('isCorrect');
    const query = prisma.$queryRaw.mock.calls[0];
    expect(String(query[0])).toContain('student_id');
    expect(query.slice(1)).toEqual([
      'attempt-1',
      'test-1',
      'student-1',
      'org-1',
    ]);
  });

  it('hides an attempt that is not owned by this student and test', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    const error = await caught(
      service.get(student as never, 'test-1', 'attempt-1'),
    );
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe(ATTEMPT_NOT_FOUND_MESSAGE);
    expect(prisma.theoryTestAttempt.findFirst).not.toHaveBeenCalled();
  });

  it('expires the attempt on read when the server deadline has passed', async () => {
    jest.setSystemTime(new Date('2026-11-21T12:20:00.000Z'));
    prisma.enrollment.findFirst.mockResolvedValue(null);
    const view = await service.get(student as never, 'test-1', 'attempt-1');
    expect(view.status).toBe(TheoryTestAttemptStatus.EXPIRED);
    expect(view.score).toBeNull();
    expect(JSON.stringify(view)).not.toContain('isCorrect');
    expect(prisma.theoryTestResult.upsert).not.toHaveBeenCalled();
    expect(prisma.course.findFirst).not.toHaveBeenCalled();
  });

  it('blocks a running attempt when the test is no longer published', async () => {
    testRow = catalog({
      publicationStatus: TheoryTestPublicationStatus.DRAFT,
    });
    const error = await caught(
      service.get(student as never, 'test-1', 'attempt-1'),
    );
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(prisma.theoryTestAttempt.update).not.toHaveBeenCalled();
  });

  it('reveals correct answers only after the attempt was graded', async () => {
    currentAttempt = snapshot(TheoryTestAttemptStatus.PASSED, 100);
    const view = await service.get(student as never, 'test-1', 'attempt-1');
    expect(view.score).toBe(100);
    expect(view.questions[0].options[1]).toMatchObject({
      id: 'option-2',
      isCorrect: true,
      selected: true,
    });
    expect(prisma.course.findFirst).not.toHaveBeenCalled();
  });

  it('grades an in-time submit and stores one course result', async () => {
    const view = await service.submit(student as never, 'test-1', 'attempt-1', {
      answers: [{ questionId: 'question-1', optionIds: ['option-2'] }],
    });
    expect(prisma.theoryTestAttemptAnswer.create).toHaveBeenCalledWith({
      data: {
        attemptId: 'attempt-1',
        questionId: 'snap-q-1',
        selections: {
          create: [{ questionId: 'snap-q-1', optionId: 'snap-o-2' }],
        },
      },
    });
    expect(prisma.theoryTestAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TheoryTestAttemptStatus.PASSED,
          score: 100,
          submittedAt: now,
        }),
      }),
    );
    expect(prisma.theoryTestResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          studentId_courseId: { studentId: 'student-1', courseId: 'course-1' },
        },
        create: expect.objectContaining({
          status: TheoryTestStatus.PASSED,
          score: 100,
          studentId: 'student-1',
        }),
      }),
    );
    expect(view.status).toBe(TheoryTestAttemptStatus.PASSED);
    expect(view.questions[0].options[1]).toMatchObject({
      isCorrect: true,
      selected: true,
    });
  });

  it('fails the attempt when the score is below the threshold', async () => {
    await service.submit(student as never, 'test-1', 'attempt-1', {
      answers: [{ questionId: 'question-1', optionIds: ['option-1'] }],
    });
    expect(prisma.theoryTestAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TheoryTestAttemptStatus.FAILED,
          score: 0,
        }),
      }),
    );
    expect(prisma.theoryTestResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: TheoryTestStatus.FAILED }),
      }),
    );
  });

  it('does not grade answers after the server deadline and does not write a course result', async () => {
    jest.setSystemTime(new Date('2026-11-21T12:20:00.000Z'));
    const view = await service.submit(student as never, 'test-1', 'attempt-1', {
      answers: [{ questionId: 'question-1', optionIds: ['option-2'] }],
    });
    expect(view.status).toBe(TheoryTestAttemptStatus.EXPIRED);
    expect(prisma.theoryTestAttemptAnswer.create).not.toHaveBeenCalled();
    expect(prisma.theoryTestResult.upsert).not.toHaveBeenCalled();
    expect(JSON.stringify(view)).not.toContain('isCorrect');
  });

  it('returns the stored result when answers are submitted again', async () => {
    currentAttempt = snapshot(TheoryTestAttemptStatus.PASSED, 100);
    const view = await service.submit(student as never, 'test-1', 'attempt-1', {
      answers: [{ questionId: 'question-1', optionIds: ['option-1'] }],
    });
    expect(view).toMatchObject({
      status: TheoryTestAttemptStatus.PASSED,
      score: 100,
    });
    expect(prisma.theoryTestAttempt.update).not.toHaveBeenCalled();
    expect(prisma.theoryTestAttemptAnswer.create).not.toHaveBeenCalled();
    expect(prisma.theoryTestResult.upsert).not.toHaveBeenCalled();
  });

  it('rejects answers that do not belong to the attempt', async () => {
    const error = await caught(
      service.submit(student as never, 'test-1', 'attempt-1', {
        answers: [
          { questionId: 'question-1', optionIds: ['option-1', 'option-2'] },
        ],
      }),
    );
    expect(error.getResponse()).toEqual({
      statusCode: 400,
      errors: [
        {
          field: 'answers[0].optionIds',
          message: 'Для цього питання можна обрати лише один варіант.',
        },
      ],
    });
    expect(prisma.theoryTestAttempt.update).not.toHaveBeenCalled();
  });
});
