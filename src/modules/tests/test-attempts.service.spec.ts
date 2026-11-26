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
  EnrollmentStatus,
  Prisma,
  TheoryTestAttemptStatus,
  TheoryTestFormat,
  TheoryTestPublicationStatus,
  TheoryTestStatus,
  User,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { COURSE_NOT_PUBLISHED_MESSAGE } from '../courses/courses.service';
import {
  LESSON_LOCKED_MESSAGE,
  LESSON_RETRY_MESSAGE,
} from '../courses/lesson-gate';
import { MyTestAttemptsQueryDto } from './test-attempts.dto';
import {
  NextAttemptBlockReason,
  SINGLE_OPTION_MESSAGE,
  UNKNOWN_OPTION_MESSAGE,
  UNKNOWN_QUESTION_MESSAGE,
} from './test-attempts.rules';
import {
  ALREADY_PASSED_MESSAGE,
  ATTEMPT_COMPLETED_MESSAGE,
  ATTEMPT_EXPIRED_MESSAGE,
  ATTEMPT_IN_PROGRESS_MESSAGE,
  ATTEMPT_NOT_FOUND_MESSAGE,
  ATTEMPT_NO_QUESTIONS_MESSAGE,
  ATTEMPTS_EXHAUSTED_MESSAGE,
  GROUP_NOT_FOUND_MESSAGE,
  TEST_RESULT_NOT_FOUND_MESSAGE,
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

const now = new Date('2026-11-21T12:00:00.000Z');
const deadline = new Date('2026-11-21T12:20:00.000Z');
const beforeNow = new Date('2026-11-21T11:59:59.000Z');

type Status = TheoryTestAttemptStatus;
const { IN_PROGRESS, PASSED, FAILED, EXPIRED } = TheoryTestAttemptStatus;

/** Рядок тесту для вибірки каталогу і результату. За замовчуванням — старий тест курсу без уроку. */
function catalog(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-1',
    courseId: 'course-1',
    courseLessonId: null as string | null,
    format: TheoryTestFormat.SINGLE_CHOICE as TheoryTestFormat,
    passingScore: 90,
    timeLimitMinutes: 20 as number | null,
    maxAttempts: null as number | null,
    shuffleQuestions: false,
    publicationStatus:
      TheoryTestPublicationStatus.PUBLISHED as TheoryTestPublicationStatus,
    questions: [
      {
        id: 'question-1',
        type: TheoryTestFormat.SINGLE_CHOICE as TheoryTestFormat,
        text: 'Що означає цей знак?',
        position: 1,
        options: [
          { id: 'option-1', text: 'Ні', isCorrect: false, position: 1 },
          { id: 'option-2', text: 'Так', isCorrect: true, position: 2 },
        ],
      },
      {
        id: 'question-2',
        type: TheoryTestFormat.SINGLE_CHOICE as TheoryTestFormat,
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

/** Тест уроку: рівно 3 спроби, прив’язка до уроку. */
function lessonTest(overrides: Record<string, unknown> = {}) {
  return catalog({ courseLessonId: 'lesson-1', maxAttempts: 3, ...overrides });
}

/** Спроба зі знімком питань. Збережені відповіді PASSED — правильні, FAILED — неправильні. */
function snapshot(
  status: Status = IN_PROGRESS,
  overrides: Record<string, unknown> = {},
) {
  const passed = status === PASSED;
  const failed = status === FAILED;
  const graded = passed || failed;
  return {
    id: 'attempt-1',
    testId: 'test-1',
    courseId: 'course-1',
    studentId: 'student-1',
    status,
    cycle: 1,
    attemptNumber: 1,
    startedAt: now,
    expiresAt: deadline,
    submittedAt: status === IN_PROGRESS ? null : now,
    score: (passed ? 100 : failed ? 0 : null) as number | null,
    correctCount: (passed ? 2 : failed ? 0 : null) as number | null,
    totalQuestions: (graded ? 2 : null) as number | null,
    passingScore: 90,
    timeLimitMinutes: 20 as number | null,
    test: {
      courseLessonId: null as string | null,
      maxAttempts: null as number | null,
    },
    questions: [
      {
        id: 'snap-q-1',
        sourceQuestionId: 'question-1',
        type: TheoryTestFormat.SINGLE_CHOICE as TheoryTestFormat,
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
        answers: passed
          ? [{ selections: [{ optionId: 'snap-o-2' }] }]
          : failed
            ? [{ selections: [{ optionId: 'snap-o-1' }] }]
            : [],
      },
      {
        id: 'snap-q-2',
        sourceQuestionId: 'question-2',
        type: TheoryTestFormat.SINGLE_CHOICE as TheoryTestFormat,
        text: 'Друге питання?',
        position: 2,
        options: [
          {
            id: 'snap-o-3',
            sourceOptionId: 'option-3',
            text: 'А',
            position: 1,
            isCorrect: true,
          },
          {
            id: 'snap-o-4',
            sourceOptionId: 'option-4',
            text: 'Б',
            position: 2,
            isCorrect: false,
          },
        ],
        answers: passed ? [{ selections: [{ optionId: 'snap-o-3' }] }] : [],
      },
    ],
    ...overrides,
  };
}

type AttemptFixture = ReturnType<typeof snapshot>;

/** Проміжні відповіді спроби: snapshotQuestionId → snapshotOptionIds. */
function withSelections(
  attempt: AttemptFixture,
  selections: Record<string, string[]>,
): AttemptFixture {
  return {
    ...attempt,
    questions: attempt.questions.map((question) => {
      const optionIds = selections[question.id] ?? [];
      return {
        ...question,
        answers:
          optionIds.length > 0
            ? [{ selections: optionIds.map((optionId) => ({ optionId })) }]
            : [],
      };
    }),
  };
}

/** Рядок історії спроб (historySelect) і запису шлюзу уроку. */
function historyRow(status: Status, overrides: Record<string, unknown> = {}) {
  const passed = status === PASSED;
  const failed = status === FAILED;
  return {
    id: 'attempt-h',
    testId: 'test-1',
    studentId: 'student-1',
    status,
    score: (passed ? 100 : failed ? 0 : null) as number | null,
    passingScore: 90,
    startedAt: now,
    submittedAt: status === IN_PROGRESS ? null : now,
    expiresAt: null as Date | null,
    cycle: 1,
    attemptNumber: 1,
    correctCount: (passed ? 2 : failed ? 0 : null) as number | null,
    totalQuestions: (passed || failed ? 2 : null) as number | null,
    _count: { questions: 2 },
    ...overrides,
  };
}

/** Рядок списків спроб (listSelect). */
function listRow(status: Status, overrides: Record<string, unknown> = {}) {
  return {
    ...historyRow(status),
    id: 'attempt-1',
    courseId: 'course-1',
    test: {
      name: 'Тест: дорожні знаки',
      courseLessonId: null as string | null,
      maxAttempts: null as number | null,
    },
    student: { firstName: 'Олена', lastName: 'Коваль' },
    ...overrides,
  };
}

describe('TestAttemptsService', () => {
  const student = {
    id: 'student-1',
    role: UserRole.STUDENT,
    organizationId: 'org-1',
  } as User;
  const admin = {
    id: 'admin-1',
    role: UserRole.ADMIN,
    organizationId: 'org-1',
  } as User;
  const teacher = {
    id: 'teacher-1',
    role: UserRole.TEACHER,
    organizationId: 'org-1',
  } as User;
  const publishedCourse = {
    id: 'course-1',
    status: CourseStatus.ACTIVE,
    publicationStatus: CoursePublicationStatus.PUBLISHED,
  };

  let testRow: ReturnType<typeof catalog> | null = null;
  let openAttempt: { id: string; expiresAt: Date | null } | null = null;
  let currentAttempt: AttemptFixture | null = null;
  /** Що віддає theoryTestAttempt.findMany: історія спроб або рядки списку. */
  let attemptRows: unknown[] = [];

  const prisma = {
    organization: { findUnique: jest.fn() },
    course: { findFirst: jest.fn() },
    enrollment: { findFirst: jest.fn(), findMany: jest.fn() },
    group: { findFirst: jest.fn(), findMany: jest.fn() },
    courseLesson: { findMany: jest.fn() },
    courseLessonCompletion: { findFirst: jest.fn(), findMany: jest.fn() },
    theoryTest: { findFirst: jest.fn(), findMany: jest.fn() },
    theoryTestAttempt: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    theoryTestAttemptAnswer: { create: jest.fn(), deleteMany: jest.fn() },
    user: { findFirst: jest.fn() },
    theoryTestResult: { upsert: jest.fn() },
    student: { findUnique: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };

  let service: TestAttemptsService;
  let log: jest.SpyInstance;

  /**
   * Шлюз уроків курсу: які уроки опубліковано, у якому циклі студент і який тест опубліковано в уроці.
   * Дає ті самі дані для loadLessonGate і для currentCycle/cyclesFor.
   */
  function givenGate(
    options: {
      lessons?: Array<{ id: string; position: number }>;
      completions?: Array<{ lessonId: string; testCycle: number }>;
      tests?: Array<{
        id: string;
        courseLessonId: string;
        maxAttempts: number | null;
      }>;
    } = {},
  ) {
    const completions = (options.completions ?? []).map((row) => ({
      ...row,
      studentId: 'student-1',
    }));
    prisma.courseLesson.findMany.mockResolvedValue(
      (options.lessons ?? [{ id: 'lesson-1', position: 1 }]).map((lesson) => ({
        ...lesson,
        chapter: { position: 1 },
      })),
    );
    prisma.courseLessonCompletion.findMany.mockResolvedValue(completions);
    prisma.courseLessonCompletion.findFirst.mockImplementation(
      (args: { where: { lessonId: string } }) =>
        Promise.resolve(
          completions.find((row) => row.lessonId === args.where.lessonId) ??
            null,
        ),
    );
    prisma.theoryTest.findMany.mockResolvedValue(
      options.tests ?? [
        { id: 'test-1', courseLessonId: 'lesson-1', maxAttempts: 3 },
      ],
    );
  }

  /** SQL блокування спроби в тому вигляді, в якому він піде в базу: з параметрами в порядку виклику. */
  function lockQuery(): Prisma.Sql {
    const [strings, ...values] = prisma.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    return Prisma.sql(strings, ...values);
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    jest.resetAllMocks();
    testRow = catalog();
    openAttempt = null;
    currentAttempt = snapshot();
    attemptRows = [];
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      deletedAt: null,
    });
    prisma.course.findFirst.mockResolvedValue(publishedCourse);
    prisma.enrollment.findFirst.mockResolvedValue({ id: 'enrollment-1' });
    prisma.enrollment.findMany.mockResolvedValue([]);
    prisma.group.findFirst.mockResolvedValue(null);
    prisma.group.findMany.mockResolvedValue([]);
    prisma.courseLesson.findMany.mockResolvedValue([]);
    prisma.courseLessonCompletion.findFirst.mockResolvedValue(null);
    prisma.courseLessonCompletion.findMany.mockResolvedValue([]);
    prisma.theoryTest.findFirst.mockImplementation(() =>
      Promise.resolve(testRow),
    );
    prisma.theoryTest.findMany.mockResolvedValue([]);
    prisma.theoryTestAttempt.findMany.mockImplementation(() =>
      Promise.resolve(attemptRows),
    );
    prisma.theoryTestAttempt.count.mockImplementation(() =>
      Promise.resolve(attemptRows.length),
    );
    prisma.theoryTestAttempt.updateMany.mockResolvedValue({ count: 0 });
    prisma.theoryTestAttempt.findFirst.mockImplementation(
      (args: { where?: { status?: TheoryTestAttemptStatus } }) =>
        Promise.resolve(
          args.where?.status === IN_PROGRESS ? openAttempt : currentAttempt,
        ),
    );
    prisma.theoryTestAttempt.create.mockImplementation(
      ({
        data,
      }: {
        data: {
          cycle: number;
          attemptNumber: number;
          expiresAt: Date | null;
          timeLimitMinutes: number | null;
        };
      }) =>
        Promise.resolve({
          ...snapshot(),
          cycle: data.cycle,
          attemptNumber: data.attemptNumber,
          expiresAt: data.expiresAt,
          timeLimitMinutes: data.timeLimitMinutes,
          test: {
            courseLessonId: testRow?.courseLessonId ?? null,
            maxAttempts: testRow?.maxAttempts ?? null,
          },
        }),
    );
    prisma.theoryTestAttempt.update.mockImplementation(
      ({ data }: { data: { status?: TheoryTestAttemptStatus } }) => {
        const base = currentAttempt ?? snapshot();
        const status = data.status ?? base.status;
        const graded = status === PASSED || status === FAILED;
        return Promise.resolve({
          ...base,
          ...data,
          questions: base.questions.map((question, index) => ({
            ...question,
            answers: graded
              ? snapshot(status).questions[index].answers
              : question.answers,
          })),
        });
      },
    );
    prisma.theoryTestAttemptAnswer.create.mockResolvedValue({ id: 'answer-1' });
    prisma.theoryTestAttemptAnswer.deleteMany.mockResolvedValue({ count: 0 });
    prisma.theoryTestResult.upsert.mockResolvedValue({ id: 'result-1' });
    prisma.student.findUnique.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue(null);
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

  describe('access', () => {
    const studentOnly: Array<[string, (actor: User) => Promise<unknown>]> = [
      ['start', (actor) => service.start(actor, 'test-1')],
      ['get', (actor) => service.get(actor, 'attempt-1')],
      [
        'saveAnswers',
        (actor) => service.saveAnswers(actor, 'attempt-1', { answers: [] }),
      ],
      ['submit', (actor) => service.submit(actor, 'attempt-1', {})],
      ['expire', (actor) => service.expire(actor, 'attempt-1')],
      ['listOwn', (actor) => service.listOwn(actor, 'test-1')],
      ['listMyAttempts', (actor) => service.listMyAttempts(actor)],
      ['getOwnResult', (actor) => service.getOwnResult(actor, 'test-1')],
    ];

    it.each(studentOnly)(
      '%s is closed to staff before the organization is read',
      async (_name, call) => {
        for (const role of [
          UserRole.TEACHER,
          UserRole.ADMIN,
          UserRole.INSTRUCTOR,
          UserRole.OWNER,
        ]) {
          const error = await caught(call({ ...student, role }));
          expect(error).toBeInstanceOf(ForbiddenException);
        }
        expect(prisma.organization.findUnique).not.toHaveBeenCalled();
      },
    );

    it.each(studentOnly)(
      '%s hides a deleted organization',
      async (_name, call) => {
        prisma.organization.findUnique.mockResolvedValue({
          id: 'org-1',
          deletedAt: now,
        });
        const error = await caught(call(student));
        expect(error).toBeInstanceOf(NotFoundException);
        expect(prisma.theoryTest.findFirst).not.toHaveBeenCalled();
        expect(prisma.theoryTestAttempt.create).not.toHaveBeenCalled();
      },
    );

    const staffOnly: Array<[string, (actor: User) => Promise<unknown>]> = [
      ['listForTest', (actor) => service.listForTest(actor, 'test-1')],
      ['listAttempts', (actor) => service.listAttempts(actor)],
      ['listResults', (actor) => service.listResults(actor, 'test-1')],
      [
        'getStudentResult',
        (actor) => service.getStudentResult(actor, 'test-1', 'student-1'),
      ],
    ];

    it.each(staffOnly)(
      '%s is closed to students and instructors',
      async (_name, call) => {
        for (const role of [
          UserRole.STUDENT,
          UserRole.INSTRUCTOR,
          UserRole.OWNER,
        ]) {
          const error = await caught(call({ ...admin, role }));
          expect(error).toBeInstanceOf(ForbiddenException);
        }
        expect(prisma.organization.findUnique).not.toHaveBeenCalled();
      },
    );
  });

  describe('start', () => {
    it('creates a separate attempt with the student, test, start time and deadline', async () => {
      const started = await service.start(student, 'test-1');
      const data = prisma.theoryTestAttempt.create.mock.calls[0][0].data;

      expect(prisma.$executeRaw.mock.calls[0][1]).toBe(
        'test-attempt:student-1:test-1',
      );
      expect(data).toMatchObject({
        organizationId: 'org-1',
        courseId: 'course-1',
        testId: 'test-1',
        studentId: 'student-1',
        status: IN_PROGRESS,
        cycle: 1,
        attemptNumber: 1,
        passingScore: 90,
        timeLimitMinutes: 20,
        startedAt: now,
        expiresAt: deadline,
      });
      expect(data.questions.create[0]).toMatchObject({
        sourceQuestionId: 'question-1',
        type: TheoryTestFormat.SINGLE_CHOICE,
      });
      expect(data.questions.create[0].options.create[1]).toMatchObject({
        sourceOptionId: 'option-2',
        isCorrect: true,
      });
      expect(started).toMatchObject({
        id: 'attempt-1',
        studentId: 'student-1',
        testId: 'test-1',
        lessonId: null,
        status: 'IN_PROGRESS',
        result: null,
        cycle: 1,
        attemptNumber: 1,
        startedAt: now,
        scorePercent: null,
        earnedPoints: null,
        correctCount: null,
        maxPoints: 2,
        totalQuestions: 2,
      });
      expect(started.questions[0].id).toBe('question-1');
      expect(started.questions[0].options[1]).toEqual({
        id: 'option-2',
        text: 'Так',
        position: 2,
      });
      expect(JSON.stringify(started)).not.toContain('isCorrect');
    });

    it('writes the snapshot rows with scalar columns only, which Prisma accepts in a nested create', async () => {
      await service.start(student, 'test-1');
      const questions =
        prisma.theoryTestAttempt.create.mock.calls[0][0].data.questions.create;

      // Ключі зовнішніх зв’язків (testId, questionId) у вкладеному create Prisma не приймає.
      expect(Object.keys(questions[0]).sort()).toEqual([
        'options',
        'position',
        'sourceQuestionId',
        'text',
        'type',
      ]);
      expect(Object.keys(questions[0].options.create[0]).sort()).toEqual([
        'isCorrect',
        'position',
        'sourceOptionId',
        'text',
      ]);
    });

    it('stores no deadline when the test does not limit time', async () => {
      testRow = catalog({ timeLimitMinutes: null });
      const started = await service.start(student, 'test-1');
      expect(started.expiresAt).toBeNull();
      expect(started.timeLimitMinutes).toBeNull();
    });

    it('fixes a shuffled question order on the attempt', async () => {
      testRow = catalog({ shuffleQuestions: true });
      const random = jest.spyOn(Math, 'random').mockReturnValue(0);
      try {
        await service.start(student, 'test-1');
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

    it('allows another attempt of a course test without a limit once the previous one is finished', async () => {
      attemptRows = [historyRow(FAILED)];
      await service.start(student, 'test-1');
      await service.start(student, 'test-1');
      expect(prisma.theoryTestAttempt.create).toHaveBeenCalledTimes(2);
    });

    it('does not open a second attempt while the current one is still running', async () => {
      openAttempt = { id: 'attempt-open', expiresAt: deadline };
      const error = await caught(service.start(student, 'test-1'));
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual({
        statusCode: 409,
        message: ATTEMPT_IN_PROGRESS_MESSAGE,
        reason: NextAttemptBlockReason.IN_PROGRESS,
        attemptId: 'attempt-open',
      });
      expect(prisma.theoryTestAttempt.create).not.toHaveBeenCalled();
    });

    it('closes an expired open attempt and then starts a new one', async () => {
      openAttempt = { id: 'attempt-old', expiresAt: beforeNow };
      await service.start(student, 'test-1');
      expect(prisma.theoryTestAttempt.update).toHaveBeenCalledWith({
        where: { id: 'attempt-old' },
        data: { status: EXPIRED, submittedAt: now },
      });
      expect(prisma.theoryTestAttempt.create).toHaveBeenCalledTimes(1);
    });

    it('returns 404 for a missing test and 403 when the student cannot take it', async () => {
      testRow = null;
      const missing = await caught(service.start(student, 'test-1'));
      expect(missing).toBeInstanceOf(NotFoundException);
      expect(missing.message).toBe(TEST_NOT_FOUND_MESSAGE);

      testRow = catalog({
        publicationStatus: TheoryTestPublicationStatus.DRAFT,
      });
      const draft = await caught(service.start(student, 'test-1'));
      expect(draft).toBeInstanceOf(ForbiddenException);
      expect(draft.message).toBe(TEST_NOT_PUBLISHED_MESSAGE);

      testRow = catalog({
        publicationStatus: TheoryTestPublicationStatus.ARCHIVED,
      });
      const archived = await caught(service.start(student, 'test-1'));
      expect(archived).toBeInstanceOf(ForbiddenException);
      expect(archived.message).toBe(TEST_NOT_PUBLISHED_MESSAGE);

      testRow = catalog();
      prisma.enrollment.findFirst.mockResolvedValue(null);
      const denied = await caught(service.start(student, 'test-1'));
      expect(denied).toBeInstanceOf(ForbiddenException);

      prisma.enrollment.findFirst.mockResolvedValue({ id: 'enrollment-1' });
      prisma.course.findFirst.mockResolvedValue({
        ...publishedCourse,
        publicationStatus: CoursePublicationStatus.DRAFT,
      });
      const unpublished = await caught(service.start(student, 'test-1'));
      expect(unpublished).toBeInstanceOf(ForbiddenException);
      expect(unpublished.message).toBe(COURSE_NOT_PUBLISHED_MESSAGE);
      expect(prisma.theoryTestAttempt.create).not.toHaveBeenCalled();
    });

    it('looks the test up only in the organization of the student', async () => {
      await service.start(student, 'test-1');
      expect(prisma.theoryTest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'test-1', organizationId: 'org-1' },
        }),
      );
    });

    it('refuses to start a test that has no questions', async () => {
      testRow = catalog({ questions: [] });
      const error = await caught(service.start(student, 'test-1'));
      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'questions', message: ATTEMPT_NO_QUESTIONS_MESSAGE }],
      });
    });

    it('does not start another attempt after a course test is passed', async () => {
      attemptRows = [historyRow(PASSED, { id: 'attempt-passed' })];
      const error = await caught(service.start(student, 'test-1'));
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual({
        statusCode: 409,
        message: ALREADY_PASSED_MESSAGE,
        reason: NextAttemptBlockReason.ALREADY_PASSED,
      });
      expect(prisma.theoryTestAttempt.create).not.toHaveBeenCalled();
    });

    it('does not start another attempt of a course test when the limit is spent', async () => {
      testRow = catalog({ maxAttempts: 1 });
      attemptRows = [historyRow(FAILED, { id: 'attempt-failed' })];
      const error = await caught(service.start(student, 'test-1'));
      expect(error.getResponse()).toEqual({
        statusCode: 409,
        message: ATTEMPTS_EXHAUSTED_MESSAGE,
        reason: NextAttemptBlockReason.ATTEMPTS_EXHAUSTED,
      });
      expect(prisma.theoryTestAttempt.create).not.toHaveBeenCalled();
    });

    it('answers 409 when a parallel start already opened an attempt', async () => {
      prisma.theoryTestAttempt.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['student_id', 'test_id'] },
        }),
      );
      const error = await caught(service.start(student, 'test-1'));
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual({
        statusCode: 409,
        message: ATTEMPT_IN_PROGRESS_MESSAGE,
      });
    });

    it('does not hide other database errors behind the duplicate message', async () => {
      prisma.theoryTestAttempt.create.mockRejectedValue(new Error('db down'));
      await expect(service.start(student, 'test-1')).rejects.toThrow('db down');
    });

    describe('lesson test', () => {
      beforeEach(() => {
        testRow = lessonTest();
        givenGate();
      });

      it('starts attempt 1 of cycle 1 and exposes the lesson and the limit', async () => {
        const started = await service.start(student, 'test-1');
        expect(
          prisma.theoryTestAttempt.create.mock.calls[0][0].data,
        ).toMatchObject({ cycle: 1, attemptNumber: 1 });
        expect(started).toMatchObject({
          lessonId: 'lesson-1',
          maxAttempts: 3,
          cycle: 1,
          attemptNumber: 1,
        });
      });

      it('does not require the lesson to be marked as done first', async () => {
        await service.start(student, 'test-1');
        expect(prisma.theoryTestAttempt.create).toHaveBeenCalledTimes(1);
      });

      it('numbers the attempt after the slots of the current cycle that are already taken', async () => {
        attemptRows = [
          historyRow(FAILED, { id: 'attempt-a', attemptNumber: 1 }),
          historyRow(EXPIRED, { id: 'attempt-b', attemptNumber: 2 }),
        ];
        await service.start(student, 'test-1');
        expect(
          prisma.theoryTestAttempt.create.mock.calls[0][0].data,
        ).toMatchObject({ cycle: 1, attemptNumber: 3 });
      });

      it('begins a fresh cycle after the lesson was passed again with the attempts spent', async () => {
        givenGate({ completions: [{ lessonId: 'lesson-1', testCycle: 2 }] });
        attemptRows = [
          historyRow(FAILED, { id: 'a-1', attemptNumber: 1 }),
          historyRow(FAILED, { id: 'a-2', attemptNumber: 2 }),
          historyRow(FAILED, { id: 'a-3', attemptNumber: 3 }),
        ];
        await service.start(student, 'test-1');
        expect(
          prisma.theoryTestAttempt.create.mock.calls[0][0].data,
        ).toMatchObject({ cycle: 2, attemptNumber: 1 });
      });

      it('sends the student back to the lesson once the three attempts of the cycle failed', async () => {
        attemptRows = [
          historyRow(FAILED, { id: 'a-1', attemptNumber: 1 }),
          historyRow(FAILED, { id: 'a-2', attemptNumber: 2 }),
          historyRow(FAILED, { id: 'a-3', attemptNumber: 3 }),
        ];
        const error = await caught(service.start(student, 'test-1'));
        expect(error).toBeInstanceOf(ConflictException);
        expect(error.getResponse()).toEqual({
          statusCode: 409,
          message: LESSON_RETRY_MESSAGE,
          reason: NextAttemptBlockReason.ATTEMPTS_EXHAUSTED,
        });
        expect(prisma.theoryTestAttempt.create).not.toHaveBeenCalled();
      });

      it('does not start another attempt after the lesson test is passed', async () => {
        attemptRows = [historyRow(PASSED, { id: 'attempt-passed' })];
        const error = await caught(service.start(student, 'test-1'));
        expect(error.getResponse()).toEqual({
          statusCode: 409,
          message: ALREADY_PASSED_MESSAGE,
          reason: NextAttemptBlockReason.ALREADY_PASSED,
        });
      });

      it('does not open a second attempt while one of the lesson test is running', async () => {
        attemptRows = [
          historyRow(IN_PROGRESS, {
            id: 'attempt-open',
            expiresAt: deadline,
          }),
        ];
        const error = await caught(service.start(student, 'test-1'));
        expect(error.getResponse()).toEqual({
          statusCode: 409,
          message: ATTEMPT_IN_PROGRESS_MESSAGE,
          reason: NextAttemptBlockReason.IN_PROGRESS,
          attemptId: 'attempt-open',
        });
      });

      it('keeps a lesson closed until the previous one is cleared', async () => {
        givenGate({
          lessons: [
            { id: 'lesson-0', position: 1 },
            { id: 'lesson-1', position: 2 },
          ],
        });
        const error = await caught(service.start(student, 'test-1'));
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(error.message).toBe(LESSON_LOCKED_MESSAGE);
        expect(prisma.theoryTestAttempt.create).not.toHaveBeenCalled();
      });

      it('opens the lesson once the previous lesson is marked done', async () => {
        givenGate({
          lessons: [
            { id: 'lesson-0', position: 1 },
            { id: 'lesson-1', position: 2 },
          ],
          completions: [{ lessonId: 'lesson-0', testCycle: 1 }],
        });
        await service.start(student, 'test-1');
        expect(prisma.theoryTestAttempt.create).toHaveBeenCalledTimes(1);
      });

      it('refuses a lesson that is not a published lesson of the course', async () => {
        givenGate({
          lessons: [{ id: 'lesson-other', position: 1 }],
          tests: [],
        });
        const error = await caught(service.start(student, 'test-1'));
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(error.message).toBe(LESSON_LOCKED_MESSAGE);
      });

      it('refuses a test that is not the published test of its lesson', async () => {
        givenGate({
          tests: [
            { id: 'test-other', courseLessonId: 'lesson-1', maxAttempts: 3 },
          ],
        });
        const error = await caught(service.start(student, 'test-1'));
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(error.message).toBe(TEST_NOT_PUBLISHED_MESSAGE);
        expect(prisma.theoryTestAttempt.create).not.toHaveBeenCalled();
      });
    });
  });

  describe('get', () => {
    it('returns attempt questions without correct answers while time remains', async () => {
      const view = await service.get(student, 'attempt-1');
      expect(view.questions[0].options[0]).toEqual({
        id: 'option-1',
        text: 'Ні',
        position: 1,
      });
      expect(JSON.stringify(view)).not.toContain('isCorrect');
      expect(view).toMatchObject({
        status: 'IN_PROGRESS',
        result: null,
        scorePercent: null,
        correctCount: null,
        earnedPoints: null,
      });
    });

    it('restores the saved selection in catalog ids so the student can resume', async () => {
      currentAttempt = withSelections(snapshot(), {
        'snap-q-1': ['snap-o-2'],
        'snap-q-2': ['snap-o-3', 'snap-o-4'],
      });
      const view = await service.get(student, 'attempt-1');
      expect(view.answers).toEqual([
        { questionId: 'question-1', optionIds: ['option-2'] },
        { questionId: 'question-2', optionIds: ['option-3', 'option-4'] },
      ]);
      expect(JSON.stringify(view)).not.toContain('isCorrect');
      expect(JSON.stringify(view)).not.toContain('selected');
    });

    it('locks the student own attempt by attempt, student and organization', async () => {
      await service.get(student, 'attempt-1');
      const query = lockQuery();
      expect(query.text).toContain('student_id');
      expect(query.text).toContain('FOR UPDATE');
      expect(query.text).not.toContain('test_id');
      expect(query.values).toEqual(['attempt-1', 'student-1', 'org-1']);
    });

    it('hides an attempt that is not owned by this student', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      const error = await caught(service.get(student, 'attempt-1'));
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(ATTEMPT_NOT_FOUND_MESSAGE);
      expect(prisma.theoryTestAttempt.findFirst).not.toHaveBeenCalled();
    });

    it('expires the attempt on read when the server deadline has passed', async () => {
      jest.setSystemTime(deadline);
      prisma.enrollment.findFirst.mockResolvedValue(null);
      const view = await service.get(student, 'attempt-1');
      expect(view).toMatchObject({
        status: 'EXPIRED',
        result: null,
        scorePercent: null,
        correctCount: null,
      });
      expect(JSON.stringify(view)).not.toContain('isCorrect');
      expect(prisma.theoryTestAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'attempt-1' },
          data: { status: EXPIRED, submittedAt: deadline },
        }),
      );
      expect(prisma.theoryTestResult.upsert).not.toHaveBeenCalled();
      expect(prisma.course.findFirst).not.toHaveBeenCalled();
    });

    it('keeps an attempt without a time limit open', async () => {
      currentAttempt = snapshot(IN_PROGRESS, {
        expiresAt: null,
        timeLimitMinutes: null,
      });
      jest.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
      const view = await service.get(student, 'attempt-1');
      expect(view.status).toBe('IN_PROGRESS');
      expect(prisma.theoryTestAttempt.update).not.toHaveBeenCalled();
    });

    it('blocks a running attempt when the test is no longer published', async () => {
      testRow = catalog({
        publicationStatus: TheoryTestPublicationStatus.DRAFT,
      });
      const error = await caught(service.get(student, 'attempt-1'));
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(prisma.theoryTestAttempt.update).not.toHaveBeenCalled();
    });

    it('blocks a running attempt after the student left the group of the course', async () => {
      prisma.enrollment.findFirst.mockResolvedValue(null);
      const error = await caught(service.get(student, 'attempt-1'));
      expect(error).toBeInstanceOf(ForbiddenException);
    });

    it('reveals correct answers, the score and the result only after the attempt was graded', async () => {
      currentAttempt = snapshot(PASSED);
      const view = await service.get(student, 'attempt-1');
      expect(view).toMatchObject({
        status: 'COMPLETED',
        result: 'PASSED',
        scorePercent: 100,
        earnedPoints: 2,
        maxPoints: 2,
        correctCount: 2,
        totalQuestions: 2,
      });
      expect(view.questions[0].options[1]).toMatchObject({
        id: 'option-2',
        isCorrect: true,
        selected: true,
      });
      expect(view.questions[0].options[0]).toMatchObject({
        isCorrect: false,
        selected: false,
      });
      // Завершену спробу можна переглянути, навіть якщо курс уже не опубліковано.
      expect(prisma.course.findFirst).not.toHaveBeenCalled();
    });

    it('reports a failed attempt as COMPLETED with the FAILED result', async () => {
      currentAttempt = snapshot(FAILED);
      const view = await service.get(student, 'attempt-1');
      expect(view).toMatchObject({
        status: 'COMPLETED',
        result: 'FAILED',
        scorePercent: 0,
        correctCount: 0,
      });
    });

    it('never reveals answers of an expired attempt, even if some were saved', async () => {
      currentAttempt = withSelections(snapshot(EXPIRED), {
        'snap-q-1': ['snap-o-2'],
      });
      const view = await service.get(student, 'attempt-1');
      expect(view).toMatchObject({
        status: 'EXPIRED',
        result: null,
        scorePercent: null,
        correctCount: null,
      });
      expect(JSON.stringify(view)).not.toContain('isCorrect');
      expect(JSON.stringify(view)).not.toContain('selected');
    });
  });

  describe('saveAnswers', () => {
    it('replaces the selection of the listed questions and writes only option ids', async () => {
      await service.saveAnswers(student, 'attempt-1', {
        answers: [{ questionId: 'question-1', optionIds: ['option-2'] }],
      });
      expect(prisma.theoryTestAttemptAnswer.deleteMany).toHaveBeenCalledWith({
        where: { attemptId: 'attempt-1', questionId: { in: ['snap-q-1'] } },
      });
      // questionId вкладеного вибору Prisma бере з відповіді, тож у create його немає.
      expect(prisma.theoryTestAttemptAnswer.create).toHaveBeenCalledWith({
        data: {
          attemptId: 'attempt-1',
          questionId: 'snap-q-1',
          selections: { create: [{ optionId: 'snap-o-2' }] },
        },
      });
    });

    it('leaves the questions that are not listed as they were', async () => {
      await service.saveAnswers(student, 'attempt-1', {
        answers: [{ questionId: 'question-2', optionIds: ['option-3'] }],
      });
      expect(prisma.theoryTestAttemptAnswer.deleteMany).toHaveBeenCalledTimes(
        1,
      );
      expect(prisma.theoryTestAttemptAnswer.deleteMany).toHaveBeenCalledWith({
        where: { attemptId: 'attempt-1', questionId: { in: ['snap-q-2'] } },
      });
    });

    it('clears the selection of a question when optionIds is empty', async () => {
      await service.saveAnswers(student, 'attempt-1', {
        answers: [{ questionId: 'question-1', optionIds: [] }],
      });
      expect(prisma.theoryTestAttemptAnswer.deleteMany).toHaveBeenCalledWith({
        where: { attemptId: 'attempt-1', questionId: { in: ['snap-q-1'] } },
      });
      expect(prisma.theoryTestAttemptAnswer.create).not.toHaveBeenCalled();
    });

    it('does not touch answers when the list is empty', async () => {
      await service.saveAnswers(student, 'attempt-1', { answers: [] });
      expect(prisma.theoryTestAttemptAnswer.deleteMany).not.toHaveBeenCalled();
      expect(prisma.theoryTestAttemptAnswer.create).not.toHaveBeenCalled();
    });

    it('returns the attempt without correctness and does not grade it', async () => {
      currentAttempt = withSelections(snapshot(), { 'snap-q-1': ['snap-o-2'] });
      const view = await service.saveAnswers(student, 'attempt-1', {
        answers: [{ questionId: 'question-1', optionIds: ['option-2'] }],
      });
      expect(view).toMatchObject({
        status: 'IN_PROGRESS',
        result: null,
        scorePercent: null,
        answers: [{ questionId: 'question-1', optionIds: ['option-2'] }],
      });
      expect(JSON.stringify(view)).not.toContain('isCorrect');
      expect(prisma.theoryTestAttempt.update).not.toHaveBeenCalled();
      expect(prisma.theoryTestResult.upsert).not.toHaveBeenCalled();
      expect(prisma.student.findUnique).not.toHaveBeenCalled();
    });

    it('accepts several options only for a multiple choice question', async () => {
      currentAttempt = snapshot(IN_PROGRESS, {
        questions: [
          {
            ...snapshot().questions[0],
            type: TheoryTestFormat.MULTIPLE_CHOICE,
          },
        ],
      });
      await service.saveAnswers(student, 'attempt-1', {
        answers: [
          { questionId: 'question-1', optionIds: ['option-1', 'option-2'] },
        ],
      });
      expect(prisma.theoryTestAttemptAnswer.create).toHaveBeenCalledWith({
        data: {
          attemptId: 'attempt-1',
          questionId: 'snap-q-1',
          selections: {
            create: [{ optionId: 'snap-o-1' }, { optionId: 'snap-o-2' }],
          },
        },
      });
    });

    it.each([TheoryTestFormat.SINGLE_CHOICE, TheoryTestFormat.TRUE_FALSE])(
      'refuses two options for a %s question',
      async (type) => {
        currentAttempt = snapshot(IN_PROGRESS, {
          questions: [{ ...snapshot().questions[0], type }],
        });
        const error = await caught(
          service.saveAnswers(student, 'attempt-1', {
            answers: [
              { questionId: 'question-1', optionIds: ['option-1', 'option-2'] },
            ],
          }),
        );
        expect(error.getResponse()).toEqual({
          statusCode: 400,
          errors: [
            { field: 'answers[0].optionIds', message: SINGLE_OPTION_MESSAGE },
          ],
        });
        expect(
          prisma.theoryTestAttemptAnswer.deleteMany,
        ).not.toHaveBeenCalled();
      },
    );

    it('refuses an option of another question and a question outside the attempt', async () => {
      const error = await caught(
        service.saveAnswers(student, 'attempt-1', {
          answers: [
            { questionId: 'question-1', optionIds: ['option-3'] },
            { questionId: 'question-404', optionIds: ['option-1'] },
          ],
        }),
      );
      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [
          {
            field: 'answers[0].optionIds[0]',
            message: UNKNOWN_OPTION_MESSAGE,
          },
          { field: 'answers[1].questionId', message: UNKNOWN_QUESTION_MESSAGE },
        ],
      });
      expect(prisma.theoryTestAttemptAnswer.create).not.toHaveBeenCalled();
    });

    it.each([PASSED, FAILED])(
      'refuses answers for an attempt that is already %s',
      async (status) => {
        currentAttempt = snapshot(status);
        const error = await caught(
          service.saveAnswers(student, 'attempt-1', {
            answers: [{ questionId: 'question-1', optionIds: ['option-2'] }],
          }),
        );
        expect(error).toBeInstanceOf(ConflictException);
        expect(error.getResponse()).toEqual({
          statusCode: 409,
          message: ATTEMPT_COMPLETED_MESSAGE,
          status: 'COMPLETED',
        });
        expect(
          prisma.theoryTestAttemptAnswer.deleteMany,
        ).not.toHaveBeenCalled();
      },
    );

    it('refuses answers for an expired attempt', async () => {
      currentAttempt = snapshot(EXPIRED);
      const error = await caught(
        service.saveAnswers(student, 'attempt-1', {
          answers: [{ questionId: 'question-1', optionIds: ['option-2'] }],
        }),
      );
      expect(error.getResponse()).toEqual({
        statusCode: 409,
        message: ATTEMPT_EXPIRED_MESSAGE,
        status: 'EXPIRED',
      });
    });

    it('closes the attempt as EXPIRED at the server deadline instead of saving', async () => {
      jest.setSystemTime(deadline);
      const error = await caught(
        service.saveAnswers(student, 'attempt-1', {
          answers: [{ questionId: 'question-1', optionIds: ['option-2'] }],
        }),
      );
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual({
        statusCode: 409,
        message: ATTEMPT_EXPIRED_MESSAGE,
        status: 'EXPIRED',
      });
      expect(prisma.theoryTestAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'attempt-1' },
          data: { status: EXPIRED, submittedAt: deadline },
        }),
      );
      expect(prisma.theoryTestAttemptAnswer.create).not.toHaveBeenCalled();
    });

    it('blocks saving when the test is no longer published', async () => {
      testRow = catalog({
        publicationStatus: TheoryTestPublicationStatus.ARCHIVED,
      });
      const error = await caught(
        service.saveAnswers(student, 'attempt-1', {
          answers: [{ questionId: 'question-1', optionIds: ['option-2'] }],
        }),
      );
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(prisma.theoryTestAttemptAnswer.deleteMany).not.toHaveBeenCalled();
    });

    it('hides an attempt of another student', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      const error = await caught(
        service.saveAnswers(student, 'attempt-1', { answers: [] }),
      );
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(ATTEMPT_NOT_FOUND_MESSAGE);
    });
  });

  describe('submit', () => {
    const correctAnswers = [
      { questionId: 'question-1', optionIds: ['option-2'] },
      { questionId: 'question-2', optionIds: ['option-3'] },
    ];
    const wrongAnswers = [
      { questionId: 'question-1', optionIds: ['option-1'] },
      { questionId: 'question-2', optionIds: ['option-4'] },
    ];

    it('grades an in-time submit on the server and stores one course result for a course test', async () => {
      const view = await service.submit(student, 'attempt-1', {
        answers: correctAnswers,
      });

      expect(prisma.theoryTestAttemptAnswer.deleteMany).toHaveBeenCalledWith({
        where: { attemptId: 'attempt-1' },
      });
      expect(prisma.theoryTestAttemptAnswer.create).toHaveBeenNthCalledWith(1, {
        data: {
          attemptId: 'attempt-1',
          questionId: 'snap-q-1',
          selections: { create: [{ optionId: 'snap-o-2' }] },
        },
      });
      expect(prisma.theoryTestAttemptAnswer.create).toHaveBeenNthCalledWith(2, {
        data: {
          attemptId: 'attempt-1',
          questionId: 'snap-q-2',
          selections: { create: [{ optionId: 'snap-o-3' }] },
        },
      });
      expect(prisma.theoryTestAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'attempt-1' },
          data: {
            status: PASSED,
            score: 100,
            correctCount: 2,
            totalQuestions: 2,
            submittedAt: now,
          },
        }),
      );
      expect(prisma.theoryTestResult.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            studentId_courseId: {
              studentId: 'student-1',
              courseId: 'course-1',
            },
          },
          create: expect.objectContaining({
            status: TheoryTestStatus.PASSED,
            score: 100,
            studentId: 'student-1',
            testId: 'test-1',
            attemptId: 'attempt-1',
          }),
        }),
      );
      expect(prisma.student.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'student-1' } }),
      );
      expect(view).toMatchObject({
        status: 'COMPLETED',
        result: 'PASSED',
        scorePercent: 100,
        earnedPoints: 2,
        maxPoints: 2,
        correctCount: 2,
        totalQuestions: 2,
      });
      expect(view.questions[0].options[1]).toMatchObject({
        isCorrect: true,
        selected: true,
      });
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining(
          'Attempt submitted attemptId=attempt-1 testId=test-1 studentId=student-1 status=PASSED score=100 organizationId=org-1',
        ),
      );
    });

    it('fails the attempt when no answer is right', async () => {
      const view = await service.submit(student, 'attempt-1', {
        answers: wrongAnswers,
      });
      expect(prisma.theoryTestAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FAILED,
            score: 0,
            correctCount: 0,
          }),
        }),
      );
      expect(prisma.theoryTestResult.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ status: TheoryTestStatus.FAILED }),
        }),
      );
      expect(view).toMatchObject({
        status: 'COMPLETED',
        result: 'FAILED',
        scorePercent: 0,
      });
    });

    it('rounds the percentage and fails below the passing score', async () => {
      await service.submit(student, 'attempt-1', {
        answers: [correctAnswers[0], wrongAnswers[1]],
      });
      expect(prisma.theoryTestAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FAILED,
            score: 50,
            correctCount: 1,
            totalQuestions: 2,
          }),
        }),
      );
    });

    it('passes exactly at the passing score', async () => {
      currentAttempt = snapshot(IN_PROGRESS, { passingScore: 50 });
      await service.submit(student, 'attempt-1', {
        answers: [correctAnswers[0], wrongAnswers[1]],
      });
      expect(prisma.theoryTestAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: PASSED, score: 50 }),
        }),
      );
    });

    it('grades the answers saved earlier when the body has no answers', async () => {
      currentAttempt = withSelections(snapshot(), {
        'snap-q-1': ['snap-o-2'],
        'snap-q-2': ['snap-o-3'],
      });
      const view = await service.submit(student, 'attempt-1', {});
      expect(prisma.theoryTestAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: PASSED, score: 100 }),
        }),
      );
      expect(view.result).toBe('PASSED');
      expect(prisma.theoryTestAttemptAnswer.deleteMany).not.toHaveBeenCalled();
      expect(prisma.theoryTestAttemptAnswer.create).not.toHaveBeenCalled();
    });

    it('counts an unanswered question as wrong', async () => {
      await service.submit(student, 'attempt-1', {});
      expect(prisma.theoryTestAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: FAILED,
            score: 0,
            correctCount: 0,
          }),
        }),
      );
    });

    it('takes the score only from the server: a score or result in the body changes nothing', async () => {
      await service.submit(student, 'attempt-1', {
        answers: wrongAnswers,
        score: 100,
        passed: true,
        result: 'PASSED',
        status: 'PASSED',
      } as never);
      expect(prisma.theoryTestAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: FAILED, score: 0 }),
        }),
      );
    });

    it('does not write a course result for a lesson test but still syncs theory completion', async () => {
      currentAttempt = snapshot(IN_PROGRESS, {
        test: { courseLessonId: 'lesson-1', maxAttempts: 3 },
      });
      await service.submit(student, 'attempt-1', { answers: correctAnswers });
      expect(prisma.theoryTestResult.upsert).not.toHaveBeenCalled();
      expect(prisma.student.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'student-1' } }),
      );
    });

    describe('question types', () => {
      function multipleChoice() {
        return snapshot(IN_PROGRESS, {
          questions: [
            {
              ...snapshot().questions[0],
              type: TheoryTestFormat.MULTIPLE_CHOICE,
              options: [
                {
                  id: 'snap-o-1',
                  sourceOptionId: 'option-1',
                  text: 'Перший',
                  position: 1,
                  isCorrect: true,
                },
                {
                  id: 'snap-o-2',
                  sourceOptionId: 'option-2',
                  text: 'Другий',
                  position: 2,
                  isCorrect: true,
                },
                {
                  id: 'snap-o-3',
                  sourceOptionId: 'option-3',
                  text: 'Третій',
                  position: 3,
                  isCorrect: false,
                },
              ],
            },
          ],
        });
      }

      it('counts a multiple choice question only when the whole correct set is chosen', async () => {
        currentAttempt = multipleChoice();
        await service.submit(student, 'attempt-1', {
          answers: [{ questionId: 'question-1', optionIds: ['option-1'] }],
        });
        expect(prisma.theoryTestAttempt.update).toHaveBeenLastCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: FAILED, score: 0 }),
          }),
        );

        await service.submit(student, 'attempt-1', {
          answers: [
            {
              questionId: 'question-1',
              optionIds: ['option-1', 'option-2', 'option-3'],
            },
          ],
        });
        expect(prisma.theoryTestAttempt.update).toHaveBeenLastCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: FAILED, score: 0 }),
          }),
        );

        await service.submit(student, 'attempt-1', {
          answers: [
            { questionId: 'question-1', optionIds: ['option-2', 'option-1'] },
          ],
        });
        expect(prisma.theoryTestAttempt.update).toHaveBeenLastCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: PASSED, score: 100 }),
          }),
        );
      });

      it('grades a true/false question by its single answer', async () => {
        currentAttempt = snapshot(IN_PROGRESS, {
          questions: [
            {
              ...snapshot().questions[0],
              type: TheoryTestFormat.TRUE_FALSE,
            },
          ],
        });
        await service.submit(student, 'attempt-1', {
          answers: [{ questionId: 'question-1', optionIds: ['option-2'] }],
        });
        expect(prisma.theoryTestAttempt.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: PASSED, score: 100 }),
          }),
        );

        const error = await caught(
          service.submit(student, 'attempt-1', {
            answers: [
              { questionId: 'question-1', optionIds: ['option-1', 'option-2'] },
            ],
          }),
        );
        expect(error.getResponse()).toEqual({
          statusCode: 400,
          errors: [
            { field: 'answers[0].optionIds', message: SINGLE_OPTION_MESSAGE },
          ],
        });
      });
    });

    it('does not grade answers after the server deadline and does not write a course result', async () => {
      jest.setSystemTime(deadline);
      const view = await service.submit(student, 'attempt-1', {
        answers: correctAnswers,
      });
      expect(view).toMatchObject({
        status: 'EXPIRED',
        result: null,
        scorePercent: null,
        correctCount: null,
      });
      expect(prisma.theoryTestAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: EXPIRED, submittedAt: deadline },
        }),
      );
      expect(prisma.theoryTestAttemptAnswer.create).not.toHaveBeenCalled();
      expect(prisma.theoryTestResult.upsert).not.toHaveBeenCalled();
      expect(prisma.student.findUnique).not.toHaveBeenCalled();
      expect(JSON.stringify(view)).not.toContain('isCorrect');
    });

    it.each([PASSED, FAILED, EXPIRED])(
      'returns the stored %s attempt on a repeated submit and rewrites nothing',
      async (status) => {
        currentAttempt = snapshot(status);
        const view = await service.submit(student, 'attempt-1', {
          answers: status === PASSED ? wrongAnswers : correctAnswers,
        });
        const stored = snapshot(status);
        expect(view).toMatchObject({
          status: status === EXPIRED ? 'EXPIRED' : 'COMPLETED',
          result: status === EXPIRED ? null : status,
          scorePercent: stored.score,
        });
        expect(prisma.theoryTestAttempt.update).not.toHaveBeenCalled();
        expect(
          prisma.theoryTestAttemptAnswer.deleteMany,
        ).not.toHaveBeenCalled();
        expect(prisma.theoryTestAttemptAnswer.create).not.toHaveBeenCalled();
        expect(prisma.theoryTestResult.upsert).not.toHaveBeenCalled();
        expect(prisma.student.findUnique).not.toHaveBeenCalled();
      },
    );

    it('rejects answers that do not belong to the attempt', async () => {
      const error = await caught(
        service.submit(student, 'attempt-1', {
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
            message: SINGLE_OPTION_MESSAGE,
          },
        ],
      });
      expect(prisma.theoryTestAttempt.update).not.toHaveBeenCalled();
      expect(prisma.theoryTestAttemptAnswer.deleteMany).not.toHaveBeenCalled();
    });

    it('blocks a submit when the test is no longer published', async () => {
      testRow = catalog({
        publicationStatus: TheoryTestPublicationStatus.DRAFT,
      });
      const error = await caught(
        service.submit(student, 'attempt-1', { answers: correctAnswers }),
      );
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(prisma.theoryTestAttempt.update).not.toHaveBeenCalled();
    });

    it('blocks a submit after the student left the group of the course', async () => {
      prisma.enrollment.findFirst.mockResolvedValue(null);
      const error = await caught(
        service.submit(student, 'attempt-1', { answers: correctAnswers }),
      );
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(prisma.theoryTestAttempt.update).not.toHaveBeenCalled();
    });

    it('locks the attempt row by attempt, student and organization', async () => {
      await service.submit(student, 'attempt-1', {});
      expect(lockQuery().values).toEqual([
        'attempt-1',
        'student-1',
        'org-1',
      ]);
    });

    it('hides an attempt of another student', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      const error = await caught(service.submit(student, 'attempt-1', {}));
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(ATTEMPT_NOT_FOUND_MESSAGE);
      expect(prisma.theoryTestAttempt.update).not.toHaveBeenCalled();
    });

    describe('lesson test counters', () => {
      beforeEach(() => {
        testRow = lessonTest();
        currentAttempt = snapshot(IN_PROGRESS, {
          test: { courseLessonId: 'lesson-1', maxAttempts: 3 },
        });
      });

      function spentAttempts(cycle: number, count: number) {
        return Array.from({ length: count }, (_, index) =>
          historyRow(FAILED, {
            id: `attempt-${cycle}-${index + 1}`,
            cycle,
            attemptNumber: index + 1,
          }),
        );
      }

      it('reports the counters of the cycle after a failed attempt', async () => {
        attemptRows = spentAttempts(1, 1);
        const view = await service.submit(student, 'attempt-1', {
          answers: wrongAnswers,
        });
        expect(view).toMatchObject({
          lessonId: 'lesson-1',
          maxAttempts: 3,
          attemptsUsed: 1,
          attemptsLeft: 2,
        });
        expect(view.message).toBeUndefined();
      });

      it('asks to pass the lesson again once the third attempt of the cycle failed', async () => {
        attemptRows = spentAttempts(1, 3);
        const view = await service.submit(student, 'attempt-1', {
          answers: wrongAnswers,
        });
        expect(view).toMatchObject({
          result: 'FAILED',
          attemptsUsed: 3,
          attemptsLeft: 0,
          message: LESSON_RETRY_MESSAGE,
        });
      });

      it('does not repeat the retry message for an attempt of an older cycle', async () => {
        givenGate({ completions: [{ lessonId: 'lesson-1', testCycle: 2 }] });
        currentAttempt = snapshot(FAILED, {
          test: { courseLessonId: 'lesson-1', maxAttempts: 3 },
        });
        attemptRows = spentAttempts(1, 3);
        const view = await service.get(student, 'attempt-1');
        expect(view.message).toBeUndefined();
        expect(view.cycle).toBe(1);
      });
    });
  });

  describe('expire', () => {
    it('keeps the attempt open while the server deadline has not passed', async () => {
      jest.setSystemTime(new Date('2026-11-21T12:19:59.000Z'));
      const view = await service.expire(student, 'attempt-1');
      expect(view.status).toBe('IN_PROGRESS');
      expect(prisma.theoryTestAttempt.update).not.toHaveBeenCalled();
    });

    it('closes the attempt as EXPIRED at the server deadline without a score', async () => {
      jest.setSystemTime(deadline);
      const view = await service.expire(student, 'attempt-1');
      expect(prisma.theoryTestAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'attempt-1' },
          data: { status: EXPIRED, submittedAt: deadline },
        }),
      );
      expect(view).toMatchObject({
        status: 'EXPIRED',
        result: null,
        scorePercent: null,
        correctCount: null,
      });
      expect(JSON.stringify(view)).not.toContain('isCorrect');
      expect(prisma.theoryTestResult.upsert).not.toHaveBeenCalled();
    });

    it('never expires an attempt without a time limit', async () => {
      currentAttempt = snapshot(IN_PROGRESS, {
        expiresAt: null,
        timeLimitMinutes: null,
      });
      jest.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
      const view = await service.expire(student, 'attempt-1');
      expect(view.status).toBe('IN_PROGRESS');
      expect(prisma.theoryTestAttempt.update).not.toHaveBeenCalled();
    });

    it.each([PASSED, FAILED, EXPIRED])(
      'returns an attempt that is already %s unchanged',
      async (status) => {
        currentAttempt = snapshot(status);
        jest.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
        const view = await service.expire(student, 'attempt-1');
        expect(view.status).toBe(status === EXPIRED ? 'EXPIRED' : 'COMPLETED');
        expect(prisma.theoryTestAttempt.update).not.toHaveBeenCalled();
      },
    );

    it('locks the attempt by attempt, student and organization', async () => {
      await service.expire(student, 'attempt-1');
      expect(lockQuery().values).toEqual([
        'attempt-1',
        'student-1',
        'org-1',
      ]);
    });

    it('hides an attempt of another student', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      const error = await caught(service.expire(student, 'attempt-1'));
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(ATTEMPT_NOT_FOUND_MESSAGE);
    });
  });

  describe('listOwn', () => {
    beforeEach(() => {
      testRow = lessonTest();
      givenGate();
    });

    it('lists my attempts newest first with the counters of the current cycle', async () => {
      attemptRows = [
        historyRow(FAILED, {
          id: 'attempt-a',
          attemptNumber: 1,
          startedAt: new Date('2026-11-20T10:00:00.000Z'),
        }),
        historyRow(FAILED, {
          id: 'attempt-b',
          attemptNumber: 2,
          startedAt: new Date('2026-11-21T10:00:00.000Z'),
        }),
      ];
      const own = await service.listOwn(student, 'test-1');
      expect(own).toMatchObject({
        testId: 'test-1',
        lessonId: 'lesson-1',
        maxAttempts: 3,
        cycle: 1,
        passed: false,
        attemptsUsed: 2,
        attemptsLeft: 1,
        nextAttemptAvailable: true,
        unavailableReason: null,
        openAttemptId: null,
      });
      expect(own.message).toBeUndefined();
      expect(own.attempts.map((attempt) => attempt.id)).toEqual([
        'attempt-b',
        'attempt-a',
      ]);
      expect(own.attempts[0]).toMatchObject({
        status: 'COMPLETED',
        result: 'FAILED',
        cycle: 1,
        attemptNumber: 2,
        scorePercent: 0,
        lessonId: 'lesson-1',
      });
      expect(JSON.stringify(own)).not.toContain('isCorrect');
    });

    it('tells the student to pass the lesson again once the attempts of the cycle are spent', async () => {
      attemptRows = [1, 2, 3].map((number) =>
        historyRow(FAILED, { id: `attempt-${number}`, attemptNumber: number }),
      );
      const own = await service.listOwn(student, 'test-1');
      expect(own).toMatchObject({
        attemptsUsed: 3,
        attemptsLeft: 0,
        nextAttemptAvailable: false,
        unavailableReason: NextAttemptBlockReason.ATTEMPTS_EXHAUSTED,
        message: LESSON_RETRY_MESSAGE,
      });
    });

    it('starts the counters again in a new cycle and keeps the history', async () => {
      givenGate({ completions: [{ lessonId: 'lesson-1', testCycle: 2 }] });
      attemptRows = [1, 2, 3].map((number) =>
        historyRow(FAILED, { id: `attempt-${number}`, attemptNumber: number }),
      );
      const own = await service.listOwn(student, 'test-1');
      expect(own).toMatchObject({
        cycle: 2,
        attemptsUsed: 0,
        attemptsLeft: 3,
        nextAttemptAvailable: true,
        unavailableReason: null,
      });
      expect(own.message).toBeUndefined();
      expect(own.attempts).toHaveLength(3);
    });

    it('reports a passed test as closed for new attempts', async () => {
      attemptRows = [historyRow(PASSED, { id: 'attempt-passed' })];
      const own = await service.listOwn(student, 'test-1');
      expect(own).toMatchObject({
        passed: true,
        nextAttemptAvailable: false,
        unavailableReason: NextAttemptBlockReason.ALREADY_PASSED,
      });
      expect(own.message).toBeUndefined();
    });

    it('points at the open attempt so the student can resume it', async () => {
      attemptRows = [
        historyRow(IN_PROGRESS, { id: 'attempt-open', expiresAt: deadline }),
      ];
      const own = await service.listOwn(student, 'test-1');
      expect(own).toMatchObject({
        nextAttemptAvailable: false,
        unavailableReason: NextAttemptBlockReason.IN_PROGRESS,
        openAttemptId: 'attempt-open',
      });
    });

    it('closes an overdue open attempt before it counts the attempts', async () => {
      openAttempt = { id: 'attempt-old', expiresAt: beforeNow };
      await service.listOwn(student, 'test-1');
      expect(prisma.theoryTestAttempt.update).toHaveBeenCalledWith({
        where: { id: 'attempt-old' },
        data: { status: EXPIRED, submittedAt: now },
      });
    });

    it('marks the test unavailable while its lesson is still locked', async () => {
      givenGate({
        lessons: [
          { id: 'lesson-0', position: 1 },
          { id: 'lesson-1', position: 2 },
        ],
      });
      attemptRows = [historyRow(FAILED, { id: 'attempt-1' })];
      const own = await service.listOwn(student, 'test-1');
      expect(own).toMatchObject({
        nextAttemptAvailable: false,
        unavailableReason: NextAttemptBlockReason.TEST_UNAVAILABLE,
      });
    });

    it('refuses a student who has no history and no access to the test', async () => {
      prisma.enrollment.findFirst.mockResolvedValue(null);
      const error = await caught(service.listOwn(student, 'test-1'));
      expect(error).toBeInstanceOf(ForbiddenException);
    });

    it('keeps the history of an unpublished test readable', async () => {
      testRow = lessonTest({
        publicationStatus: TheoryTestPublicationStatus.ARCHIVED,
      });
      attemptRows = [historyRow(FAILED, { id: 'attempt-1' })];
      const own = await service.listOwn(student, 'test-1');
      expect(own.attempts).toHaveLength(1);
      expect(own).toMatchObject({
        nextAttemptAvailable: false,
        unavailableReason: NextAttemptBlockReason.TEST_UNAVAILABLE,
      });
    });

    it('hides a test of another organization', async () => {
      testRow = null;
      const error = await caught(service.listOwn(student, 'test-1'));
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(TEST_NOT_FOUND_MESSAGE);
    });
  });

  describe('listMyAttempts', () => {
    it('lists my attempts newest first with COMPLETED and a separate result', async () => {
      attemptRows = [
        listRow(PASSED, {
          id: 'attempt-2',
          attemptNumber: 2,
          test: {
            name: 'Тест: дорожні знаки',
            courseLessonId: 'lesson-1',
            maxAttempts: 3,
          },
        }),
        listRow(EXPIRED, { id: 'attempt-1' }),
      ];
      const listed = await service.listMyAttempts(student, {});
      expect(listed.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
      });
      expect(listed.attempts[0]).toMatchObject({
        id: 'attempt-2',
        testId: 'test-1',
        testName: 'Тест: дорожні знаки',
        lessonId: 'lesson-1',
        courseId: 'course-1',
        status: 'COMPLETED',
        result: 'PASSED',
        cycle: 1,
        attemptNumber: 2,
        scorePercent: 100,
        correctCount: 2,
        totalQuestions: 2,
      });
      expect(listed.attempts[1]).toMatchObject({
        status: 'EXPIRED',
        result: null,
        scorePercent: null,
        correctCount: null,
      });
      expect(JSON.stringify(listed)).not.toContain('isCorrect');
      expect(prisma.theoryTestAttempt.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: 'org-1', studentId: 'student-1' },
          orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
          skip: 0,
          take: 20,
        }),
      );
    });

    it('closes the overdue attempts of the student before it lists them', async () => {
      await service.listMyAttempts(student, {});
      expect(prisma.theoryTestAttempt.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          studentId: 'student-1',
          status: IN_PROGRESS,
          expiresAt: { lte: now },
        },
        data: { status: EXPIRED, submittedAt: now },
      });
    });

    it('pages the list', async () => {
      prisma.theoryTestAttempt.count.mockResolvedValue(45);
      const listed = await service.listMyAttempts(student, {
        page: 3,
        limit: 10,
      });
      expect(listed.pagination).toEqual({
        page: 3,
        limit: 10,
        total: 45,
        totalPages: 5,
      });
      expect(prisma.theoryTestAttempt.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('filters by test and by lesson of the test', async () => {
      await service.listMyAttempts(student, {
        testId: 'test-1',
        lessonId: 'lesson-1',
      });
      expect(prisma.theoryTestAttempt.count).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          studentId: 'student-1',
          testId: 'test-1',
          test: { courseLessonId: 'lesson-1' },
        },
      });
    });

    const filters: Array<
      [string, MyTestAttemptsQueryDto, TheoryTestAttemptStatus[]]
    > = [
      ['an open attempt', { status: 'IN_PROGRESS' }, [IN_PROGRESS]],
      ['a completed attempt', { status: 'COMPLETED' }, [PASSED, FAILED]],
      ['an expired attempt', { status: 'EXPIRED' }, [EXPIRED]],
      ['a passed result', { result: 'PASSED' }, [PASSED]],
      ['a failed result', { result: 'FAILED' }, [FAILED]],
      [
        'a completed attempt with a failed result',
        { status: 'COMPLETED', result: 'FAILED' },
        [FAILED],
      ],
      [
        'an expired attempt with a passed result',
        { status: 'EXPIRED', result: 'PASSED' },
        [],
      ],
    ];

    it.each(filters)(
      'maps the filter for %s to database statuses',
      async (_name, filter, expected) => {
        await service.listMyAttempts(student, filter);
        const where = prisma.theoryTestAttempt.findMany.mock.calls[0][0]
          .where as { status: { in: TheoryTestAttemptStatus[] } };
        expect([...where.status.in].sort()).toEqual([...expected].sort());
      },
    );
  });

  describe('staff attempt lists', () => {
    const studentRow = {
      studentId: 'student-1',
      status: EnrollmentStatus.ACTIVE,
      group: { id: 'group-1', name: 'Група А', courseId: 'course-1' },
    };

    it('shows an admin the attempts of the whole organization with the group of each student', async () => {
      attemptRows = [
        listRow(PASSED, {
          test: {
            name: 'Тест: дорожні знаки',
            courseLessonId: 'lesson-1',
            maxAttempts: 3,
          },
        }),
      ];
      prisma.enrollment.findMany.mockResolvedValue([studentRow]);
      const listed = await service.listForTest(admin, 'test-1');
      expect(listed.attempts).toHaveLength(1);
      expect(listed.attempts[0]).toMatchObject({
        id: 'attempt-1',
        testId: 'test-1',
        testName: 'Тест: дорожні знаки',
        lessonId: 'lesson-1',
        maxAttempts: 3,
        studentId: 'student-1',
        firstName: 'Олена',
        lastName: 'Коваль',
        groupId: 'group-1',
        groupName: 'Група А',
        status: 'COMPLETED',
        result: 'PASSED',
        scorePercent: 100,
      });
      expect(listed.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
      expect(prisma.group.findMany).not.toHaveBeenCalled();
      expect(prisma.theoryTestAttempt.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org-1',
            testId: 'test-1',
            AND: [{ student: { role: UserRole.STUDENT, deletedAt: null } }],
          },
          orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
          skip: 0,
          take: 20,
        }),
      );
      expect(JSON.stringify(listed)).not.toContain('isCorrect');
    });

    it('looks the test up in the organization of the admin', async () => {
      testRow = null;
      const error = await caught(service.listForTest(admin, 'test-1'));
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(TEST_NOT_FOUND_MESSAGE);
    });

    it('closes overdue attempts of the test before it lists them', async () => {
      await service.listForTest(admin, 'test-1');
      expect(prisma.theoryTestAttempt.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          testId: 'test-1',
          status: IN_PROGRESS,
          expiresAt: { lte: now },
        },
        data: { status: EXPIRED, submittedAt: now },
      });
    });

    it('limits a teacher to the students of their groups on the course of the test', async () => {
      prisma.group.findMany.mockResolvedValue([
        { id: 'group-1', courseId: 'course-1' },
      ]);
      attemptRows = [listRow(FAILED)];
      prisma.enrollment.findMany.mockResolvedValue([studentRow]);
      const listed = await service.listForTest(teacher, 'test-1');
      expect(prisma.group.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          courseId: 'course-1',
          teacherId: 'teacher-1',
        },
        select: { id: true, courseId: true },
      });
      expect(prisma.theoryTestAttempt.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: [
              { student: { role: UserRole.STUDENT, deletedAt: null } },
              {
                OR: [
                  {
                    courseId: 'course-1',
                    student: {
                      enrollments: {
                        some: {
                          groupId: 'group-1',
                          status: {
                            in: [
                              EnrollmentStatus.ACTIVE,
                              EnrollmentStatus.COMPLETED,
                            ],
                          },
                        },
                      },
                    },
                  },
                ],
              },
            ],
          }),
        }),
      );
      expect(prisma.enrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            group: expect.objectContaining({ teacherId: 'teacher-1' }),
          }),
        }),
      );
      expect(listed.attempts[0]).toMatchObject({
        groupId: 'group-1',
        result: 'FAILED',
      });
    });

    it('refuses a teacher who has no group on the course of the test', async () => {
      prisma.group.findMany.mockResolvedValue([]);
      const error = await caught(service.listForTest(teacher, 'test-1'));
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(prisma.theoryTestAttempt.findMany).not.toHaveBeenCalled();
    });

    it('returns an empty page for a teacher without groups when no test is chosen', async () => {
      prisma.group.findMany.mockResolvedValue([]);
      const listed = await service.listAttempts(teacher);
      expect(listed).toEqual({
        attempts: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
      expect(prisma.group.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          courseId: { not: null },
          teacherId: 'teacher-1',
        },
        select: { id: true, courseId: true },
      });
      expect(prisma.theoryTestAttempt.findMany).not.toHaveBeenCalled();
    });

    it('refuses a teacher who asks for a group of another teacher', async () => {
      prisma.group.findFirst.mockResolvedValue({
        id: 'group-2',
        teacherId: 'teacher-2',
      });
      const error = await caught(
        service.listAttempts(teacher, { groupId: 'group-2' }),
      );
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(prisma.theoryTestAttempt.findMany).not.toHaveBeenCalled();
    });

    it('answers 404 for a group that is not in the organization', async () => {
      const error = await caught(
        service.listAttempts(admin, { groupId: 'group-404' }),
      );
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(GROUP_NOT_FOUND_MESSAGE);
      expect(prisma.group.findFirst).toHaveBeenCalledWith({
        where: { id: 'group-404', organizationId: 'org-1' },
        select: { id: true, teacherId: true },
      });
    });

    it('applies the group, student and test filters of the whole list', async () => {
      prisma.group.findFirst.mockResolvedValue({
        id: 'group-1',
        teacherId: 'teacher-1',
      });
      prisma.group.findMany.mockResolvedValue([
        { id: 'group-1', courseId: 'course-1' },
      ]);
      await service.listAttempts(admin, {
        groupId: 'group-1',
        studentId: 'student-1',
        testId: 'test-1',
        status: 'COMPLETED',
        result: 'PASSED',
        page: 2,
        limit: 5,
      });
      expect(prisma.group.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          courseId: 'course-1',
          id: 'group-1',
        },
        select: { id: true, courseId: true },
      });
      expect(prisma.theoryTestAttempt.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-1',
            testId: 'test-1',
            studentId: 'student-1',
            status: { in: [PASSED] },
          }),
          skip: 5,
          take: 5,
        }),
      );
    });

    it('prefers the active group of a student over a completed one', async () => {
      attemptRows = [listRow(PASSED)];
      prisma.enrollment.findMany.mockResolvedValue([
        {
          studentId: 'student-1',
          status: EnrollmentStatus.COMPLETED,
          group: { id: 'group-old', name: 'Стара група', courseId: 'course-1' },
        },
        studentRow,
      ]);
      const listed = await service.listAttempts(admin);
      expect(listed.attempts[0]).toMatchObject({
        groupId: 'group-1',
        groupName: 'Група А',
      });
    });

    it('lists an attempt without a group when the student has no visible enrollment', async () => {
      attemptRows = [listRow(PASSED)];
      const listed = await service.listAttempts(admin);
      expect(listed.attempts[0]).toMatchObject({
        groupId: null,
        groupName: null,
      });
    });
  });

  describe('results of a course test', () => {
    it('returns the student score without correct answers and the next attempt', async () => {
      attemptRows = [historyRow(FAILED, { id: 'attempt-failed' })];
      const view = await service.getOwnResult(student, 'test-1');
      expect(view).toMatchObject({
        testId: 'test-1',
        studentId: 'student-1',
        passingScore: 90,
        attemptsUsed: 1,
        nextAttemptAvailable: true,
        result: {
          attemptId: 'attempt-failed',
          status: TheoryTestStatus.FAILED,
          score: 0,
        },
      });
      expect(JSON.stringify(view)).not.toContain('isCorrect');
      expect(prisma.theoryTest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'test-1', organizationId: 'org-1' },
        }),
      );
    });

    it('counts only the attempts of the current cycle for a lesson test', async () => {
      testRow = lessonTest();
      givenGate({ completions: [{ lessonId: 'lesson-1', testCycle: 2 }] });
      attemptRows = [1, 2, 3].map((number) =>
        historyRow(FAILED, { id: `attempt-${number}`, attemptNumber: number }),
      );
      const view = await service.getOwnResult(student, 'test-1');
      expect(view).toMatchObject({
        maxAttempts: 3,
        attemptsUsed: 0,
        attemptsRemaining: 3,
        nextAttemptAvailable: true,
        unavailableReason: null,
      });
    });

    it('hides a result of a test from another organization', async () => {
      testRow = null;
      const error = await caught(service.getOwnResult(student, 'test-1'));
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(TEST_NOT_FOUND_MESSAGE);
    });

    it('shows an admin only attempts of enrolled students in this organization', async () => {
      prisma.enrollment.findMany.mockResolvedValue([
        {
          studentId: 'student-1',
          status: 'ACTIVE',
          student: { firstName: 'Олена', lastName: 'Коваль' },
        },
      ]);
      attemptRows = [
        historyRow(PASSED, { id: 'attempt-passed' }),
        historyRow(FAILED, {
          id: 'attempt-foreign',
          studentId: 'student-2',
          score: 10,
        }),
      ];
      const listed = await service.listResults(admin, 'test-1');
      expect(listed.results).toHaveLength(1);
      expect(listed.results[0]).toMatchObject({
        studentId: 'student-1',
        firstName: 'Олена',
        result: { status: TheoryTestStatus.PASSED, score: 100 },
      });
      expect(prisma.theoryTestAttempt.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            testId: 'test-1',
            organizationId: 'org-1',
            studentId: { in: ['student-1'] },
          }),
        }),
      );
    });

    it('forbids a teacher to read a student of another group', async () => {
      prisma.user.findFirst.mockResolvedValue({
        firstName: 'Ігор',
        lastName: 'Мельник',
      });
      prisma.enrollment.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ status: 'ACTIVE' });
      const error = await caught(
        service.getStudentResult(teacher, 'test-1', 'student-1'),
      );
      expect(error).toBeInstanceOf(ForbiddenException);
    });

    it('returns 404 when the student is not enrolled on the test course', async () => {
      prisma.user.findFirst.mockResolvedValue({
        firstName: 'Ігор',
        lastName: 'Мельник',
      });
      prisma.enrollment.findFirst.mockResolvedValue(null);
      const error = await caught(
        service.getStudentResult(admin, 'test-1', 'student-1'),
      );
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(TEST_RESULT_NOT_FOUND_MESSAGE);
    });
  });
});
