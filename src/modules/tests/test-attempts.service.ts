import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  CoursePublicationStatus,
  CourseStatus,
  EnrollmentStatus,
  Prisma,
  TheoryTestAttemptStatus,
  TheoryTestPublicationStatus,
  TheoryTestStatus,
  User,
  UserRole,
} from '@prisma/client';
import { fieldBadRequest } from '../../common/validation/field-error';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  LESSON_LOCKED_MESSAGE,
  LESSON_RETRY_MESSAGE,
  loadLessonGate,
} from '../courses/lesson-gate';
import { syncTheoryCompletion } from '../students/theory-completion';
import {
  COURSE_NOT_FOUND_MESSAGE,
  COURSE_NOT_PUBLISHED_MESSAGE,
} from '../courses/courses.service';
import {
  AttemptAnswerDto,
  AttemptOptionDto,
  AttemptQuestionDto,
  AttemptSummaryDto,
  MyAttemptSummaryDto,
  MyTestAttemptListDto,
  MyTestAttemptsQueryDto,
  OwnTestAttemptsDto,
  SaveAttemptAnswersDto,
  StaffAllTestAttemptsQueryDto,
  StaffAttemptSummaryDto,
  StaffTestAttemptDto,
  StaffTestAttemptListDto,
  StaffTestAttemptsQueryDto,
  StaffTestResultDto,
  StaffTestResultListDto,
  SubmitAttemptDto,
  TestAttemptDto,
  TestOutcomeDto,
  TestScoreDto,
} from './test-attempts.dto';
import {
  AnswerSelection,
  attemptApiResult,
  AttemptApiResult,
  attemptApiStatus,
  AttemptApiStatus,
  attemptDeadline,
  gradeAttempt,
  isAttemptExpired,
  NextAttemptBlockReason,
  nextAttemptAvailability,
  selectionErrors,
  shuffleInPlace,
} from './test-attempts.rules';
import {
  TEST_NOT_FOUND_MESSAGE,
  TEST_NOT_PUBLISHED_MESSAGE,
  TEST_STUDENT_ROLES,
} from './tests.service';
import { assertFieldErrors } from './tests.rules';

export const ATTEMPT_NOT_FOUND_MESSAGE = 'Attempt not found';
export const ATTEMPT_IN_PROGRESS_MESSAGE =
  'У вас уже є незавершена спроба цього тесту.';
export const ATTEMPT_NO_QUESTIONS_MESSAGE =
  'У тесті немає питань, тож його не можна почати.';
export const ALREADY_PASSED_MESSAGE =
  'Тест уже складено. Нова спроба недоступна.';
export const ATTEMPTS_EXHAUSTED_MESSAGE = 'Ліміт спроб цього тесту вичерпано.';
export const ATTEMPT_EXPIRED_MESSAGE =
  'Час спроби вийшов. Відповіді не збережено.';
export const ATTEMPT_COMPLETED_MESSAGE =
  'Спробу вже завершено. Відповіді змінити не можна.';
export const TEST_RESULT_NOT_FOUND_MESSAGE = 'Test result not found';
export const GROUP_NOT_FOUND_MESSAGE = 'Group not found';

export const TEST_RESULT_STAFF_ROLES = [
  UserRole.ADMIN,
  UserRole.TEACHER,
] as const;

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

const VISIBLE_ENROLLMENT = [
  EnrollmentStatus.ACTIVE,
  EnrollmentStatus.COMPLETED,
] as const;

const catalogSelect = {
  id: true,
  courseId: true,
  format: true,
  passingScore: true,
  timeLimitMinutes: true,
  maxAttempts: true,
  shuffleQuestions: true,
  courseLessonId: true,
  publicationStatus: true,
  questions: {
    orderBy: { position: 'asc' as const },
    select: {
      id: true,
      type: true,
      text: true,
      position: true,
      options: {
        orderBy: { position: 'asc' as const },
        select: {
          id: true,
          text: true,
          isCorrect: true,
          position: true,
        },
      },
    },
  },
} satisfies Prisma.TheoryTestSelect;

const attemptSelect = {
  id: true,
  testId: true,
  courseId: true,
  studentId: true,
  status: true,
  cycle: true,
  attemptNumber: true,
  startedAt: true,
  expiresAt: true,
  submittedAt: true,
  score: true,
  correctCount: true,
  totalQuestions: true,
  passingScore: true,
  timeLimitMinutes: true,
  test: { select: { courseLessonId: true, maxAttempts: true } },
  questions: {
    orderBy: { position: 'asc' as const },
    select: {
      id: true,
      sourceQuestionId: true,
      type: true,
      text: true,
      position: true,
      options: {
        orderBy: { position: 'asc' as const },
        select: {
          id: true,
          sourceOptionId: true,
          text: true,
          position: true,
          isCorrect: true,
        },
      },
      answers: {
        select: {
          selections: { select: { optionId: true } },
        },
      },
    },
  },
} satisfies Prisma.TheoryTestAttemptSelect;

type CatalogTest = Prisma.TheoryTestGetPayload<{
  select: typeof catalogSelect;
}>;
type AttemptRow = Prisma.TheoryTestAttemptGetPayload<{
  select: typeof attemptSelect;
}>;

const historySelect = {
  id: true,
  studentId: true,
  status: true,
  score: true,
  passingScore: true,
  startedAt: true,
  submittedAt: true,
  expiresAt: true,
  cycle: true,
  attemptNumber: true,
  correctCount: true,
  totalQuestions: true,
  _count: { select: { questions: true } },
} satisfies Prisma.TheoryTestAttemptSelect;

const listSelect = {
  ...historySelect,
  testId: true,
  courseId: true,
  test: { select: { name: true, courseLessonId: true, maxAttempts: true } },
  student: { select: { firstName: true, lastName: true } },
} satisfies Prisma.TheoryTestAttemptSelect;

const outcomeSelect = {
  id: true,
  courseId: true,
  courseLessonId: true,
  passingScore: true,
  maxAttempts: true,
  publicationStatus: true,
  questions: { select: { id: true }, take: 1 },
} satisfies Prisma.TheoryTestSelect;

type HistoryRow = Prisma.TheoryTestAttemptGetPayload<{
  select: typeof historySelect;
}>;
type ListRow = Prisma.TheoryTestAttemptGetPayload<{
  select: typeof listSelect;
}>;
type OutcomeTest = Prisma.TheoryTestGetPayload<{
  select: typeof outcomeSelect;
}>;
type Db = Prisma.TransactionClient | PrismaService;
type VisibleStudent = {
  firstName: string;
  lastName: string;
  active: boolean;
};
type AttemptSlot = { cycle: number; attemptNumber: number };
type SummaryContext = {
  testId: string;
  courseId: string;
  lessonId: string | null;
};
type SaveOutcome = { closed: AttemptApiStatus } | { attempt: TestAttemptDto };

function assertStudent(actor: User): void {
  if (!(TEST_STUDENT_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function assertCanReadResults(actor: User): void {
  if (!(TEST_RESULT_STAFF_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

/** Правильні відповіді відкриває лише перевірена спроба. IN_PROGRESS і EXPIRED їх не бачать. */
function revealsAnswers(status: TheoryTestAttemptStatus): boolean {
  return (
    status === TheoryTestAttemptStatus.PASSED ||
    status === TheoryTestAttemptStatus.FAILED
  );
}

function attemptConflict(
  reason: NextAttemptBlockReason,
  attemptId: string | null,
  lessonTest = false,
): ConflictException {
  const message =
    reason === NextAttemptBlockReason.IN_PROGRESS
      ? ATTEMPT_IN_PROGRESS_MESSAGE
      : reason === NextAttemptBlockReason.ALREADY_PASSED
        ? ALREADY_PASSED_MESSAGE
        : lessonTest && reason === NextAttemptBlockReason.ATTEMPTS_EXHAUSTED
          ? LESSON_RETRY_MESSAGE
          : ATTEMPTS_EXHAUSTED_MESSAGE;
  return new ConflictException({
    statusCode: 409,
    message,
    reason,
    ...(attemptId ? { attemptId } : {}),
  });
}

function latestScore(history: HistoryRow[]): TestScoreDto | null {
  const graded = history.filter(
    (attempt) =>
      (attempt.status === TheoryTestAttemptStatus.PASSED ||
        attempt.status === TheoryTestAttemptStatus.FAILED) &&
      attempt.score !== null &&
      attempt.submittedAt !== null,
  );
  graded.sort(
    (left, right) =>
      (right.submittedAt?.getTime() ?? 0) - (left.submittedAt?.getTime() ?? 0),
  );
  const latest = graded[0];
  if (!latest || latest.score === null || latest.submittedAt === null) {
    return null;
  }
  return {
    attemptId: latest.id,
    status:
      latest.status === TheoryTestAttemptStatus.PASSED
        ? TheoryTestStatus.PASSED
        : TheoryTestStatus.FAILED,
    score: latest.score,
    passingScore: latest.passingScore,
    submittedAt: latest.submittedAt,
  };
}

function toAttemptSummaries(history: HistoryRow[]): StaffAttemptSummaryDto[] {
  return [...history]
    .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime())
    .map((attempt) => ({
      id: attempt.id,
      status: attempt.status,
      score: attempt.score,
      passingScore: attempt.passingScore,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
    }));
}

/**
 * Результат студента для старих ендпоінтів /result і /results.
 * cycle обмежує лічильник спроб поточним циклом уроку; для тесту без уроку cycle не задається.
 */
function toOutcome(
  test: OutcomeTest,
  studentId: string,
  history: HistoryRow[],
  now: Date,
  canTake: boolean,
  cycle?: number,
): TestOutcomeDto {
  const decision = nextAttemptAvailability(
    test.maxAttempts,
    history,
    now,
    cycle,
  );
  const blocked =
    !canTake &&
    (decision.unavailableReason === null ||
      decision.unavailableReason === NextAttemptBlockReason.IN_PROGRESS);
  return {
    testId: test.id,
    courseId: test.courseId,
    studentId,
    passingScore: test.passingScore,
    maxAttempts: test.maxAttempts,
    attemptsUsed: decision.attemptsUsed,
    attemptsRemaining: decision.attemptsRemaining,
    nextAttemptAvailable: blocked ? false : decision.nextAttemptAvailable,
    unavailableReason: blocked
      ? NextAttemptBlockReason.TEST_UNAVAILABLE
      : decision.unavailableReason,
    openAttemptId: decision.openAttemptId,
    result: latestScore(history),
  };
}

function isDuplicateOpenAttempt(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }
  const target = (error.meta as { target?: string[] | string } | undefined)
    ?.target;
  const text = Array.isArray(target) ? target.join(',') : (target ?? '');
  return (
    text.includes('studentId') ||
    text.includes('student_id') ||
    text.includes('one_in_progress')
  );
}

/**
 * Фільтр за статусом API. COMPLETED у базі — це PASSED і FAILED, а result звужує їх до одного.
 * Порожній перетин (наприклад, EXPIRED + PASSED) не віддає нічого.
 */
function statusFilter(
  status?: AttemptApiStatus,
  result?: AttemptApiResult,
): Prisma.TheoryTestAttemptWhereInput {
  if (!status && !result) {
    return {};
  }
  let allowed: TheoryTestAttemptStatus[] = Object.values(
    TheoryTestAttemptStatus,
  );
  if (status) {
    allowed = allowed.filter((value) => attemptApiStatus(value) === status);
  }
  if (result) {
    allowed = allowed.filter((value) => attemptApiResult(value) === result);
  }
  return { status: { in: allowed } };
}

/** Вибір студента в тих самих id, що бачить клієнт: питання і варіанти каталогу, не знімка. */
function savedAnswers(attempt: AttemptRow): AnswerSelection[] {
  const answers: AnswerSelection[] = [];
  for (const question of attempt.questions) {
    const selected = new Set(
      question.answers.flatMap((answer) =>
        answer.selections.map((selection) => selection.optionId),
      ),
    );
    if (selected.size === 0) {
      continue;
    }
    answers.push({
      questionId: question.sourceQuestionId,
      optionIds: question.options
        .filter((option) => selected.has(option.id))
        .map((option) => option.sourceOptionId),
    });
  }
  return answers;
}

/** Знімок питань спроби в тому вигляді, який потрібен перевірці й валідації відповідей. */
function snapshotQuestions(attempt: AttemptRow) {
  return attempt.questions.map((question) => ({
    id: question.sourceQuestionId,
    type: question.type,
    options: question.options.map((option) => ({
      id: option.sourceOptionId,
      isCorrect: option.isCorrect,
    })),
  }));
}

function toOption(
  option: AttemptRow['questions'][number]['options'][number],
  reveal: boolean,
  selectedIds: ReadonlySet<string> | null,
): AttemptOptionDto {
  const base = {
    id: option.sourceOptionId,
    text: option.text,
    position: option.position,
  };
  if (!reveal || !selectedIds) {
    return base;
  }
  return {
    ...base,
    isCorrect: option.isCorrect,
    selected: selectedIds.has(option.id),
  };
}

function toQuestion(
  question: AttemptRow['questions'][number],
  reveal: boolean,
): AttemptQuestionDto {
  const selectedIds = reveal
    ? new Set(
        question.answers.flatMap((answer) =>
          answer.selections.map((selection) => selection.optionId),
        ),
      )
    : null;
  return {
    id: question.sourceQuestionId,
    type: question.type,
    text: question.text,
    position: question.position,
    options: question.options.map((option) =>
      toOption(option, reveal, selectedIds),
    ),
  };
}

/** До перевірки студент не бачить isCorrect, бали й результат. Збережені вибори він бачить завжди. */
function toTestAttempt(
  attempt: AttemptRow,
  counters: { attemptsUsed: number; attemptsLeft: number | null },
  message?: string,
): TestAttemptDto {
  const reveal = revealsAnswers(attempt.status);
  const total = attempt.totalQuestions ?? attempt.questions.length;
  const answers: AttemptAnswerDto[] = savedAnswers(attempt).map((answer) => ({
    questionId: answer.questionId,
    optionIds: answer.optionIds,
  }));
  return {
    id: attempt.id,
    testId: attempt.testId,
    lessonId: attempt.test.courseLessonId,
    courseId: attempt.courseId,
    studentId: attempt.studentId,
    status: attemptApiStatus(attempt.status),
    result: attemptApiResult(attempt.status),
    cycle: attempt.cycle,
    attemptNumber: attempt.attemptNumber,
    maxAttempts: attempt.test.maxAttempts,
    attemptsUsed: counters.attemptsUsed,
    attemptsLeft: counters.attemptsLeft,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    submittedAt: attempt.submittedAt,
    timeLimitMinutes: attempt.timeLimitMinutes,
    passingScore: attempt.passingScore,
    scorePercent: reveal ? attempt.score : null,
    earnedPoints: reveal ? attempt.correctCount : null,
    maxPoints: total,
    correctCount: reveal ? attempt.correctCount : null,
    totalQuestions: total,
    questions: attempt.questions.map((question) =>
      toQuestion(question, reveal),
    ),
    answers,
    ...(message ? { message } : {}),
  };
}

function toSummary(
  row: HistoryRow,
  context: SummaryContext,
): AttemptSummaryDto {
  const graded = revealsAnswers(row.status);
  return {
    id: row.id,
    testId: context.testId,
    lessonId: context.lessonId,
    courseId: context.courseId,
    status: attemptApiStatus(row.status),
    result: attemptApiResult(row.status),
    cycle: row.cycle,
    attemptNumber: row.attemptNumber,
    scorePercent: graded ? row.score : null,
    correctCount: graded ? row.correctCount : null,
    totalQuestions: row.totalQuestions ?? row._count.questions,
    passingScore: row.passingScore,
    startedAt: row.startedAt,
    expiresAt: row.expiresAt,
    submittedAt: row.submittedAt,
  };
}

function toListSummary(row: ListRow): MyAttemptSummaryDto {
  return {
    ...toSummary(row, {
      testId: row.testId,
      courseId: row.courseId,
      lessonId: row.test.courseLessonId,
    }),
    testName: row.test.name,
  };
}

function toStaffAttempt(
  row: ListRow,
  group: { id: string; name: string } | null,
): StaffTestAttemptDto {
  return {
    ...toListSummary(row),
    maxAttempts: row.test.maxAttempts,
    studentId: row.studentId,
    firstName: row.student.firstName,
    lastName: row.student.lastName,
    groupId: group?.id ?? null,
    groupName: group?.name ?? null,
  };
}

function paginate(total: number, page: number, limit: number) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

@Injectable()
export class TestAttemptsService {
  private readonly logger = new Logger(TestAttemptsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /**
   * Починає спробу. Кожен успішний старт пише новий рядок з номером у циклі.
   * Незавершена і ще не прострочена спроба цього тесту не дублюється.
   * Тест уроку не вимагає позначки «урок пройдено»: матеріали переглядати не обов’язково.
   */
  async start(actor: User, testId: string): Promise<TestAttemptDto> {
    assertStudent(actor);
    await this.requireOrganization(actor.organizationId);
    const now = new Date();

    const created = await this.prisma.$transaction(async (tx) => {
      await this.lockStart(tx, actor.id, testId);
      const test = await tx.theoryTest.findFirst({
        where: { id: testId, organizationId: actor.organizationId },
        select: catalogSelect,
      });
      if (!test) {
        throw new NotFoundException(TEST_NOT_FOUND_MESSAGE);
      }
      await this.requireAssignedPublishedCourse(tx, actor, test.courseId);
      if (test.publicationStatus !== TheoryTestPublicationStatus.PUBLISHED) {
        throw new ForbiddenException(TEST_NOT_PUBLISHED_MESSAGE);
      }
      if (test.questions.length === 0) {
        throw fieldBadRequest('questions', ATTEMPT_NO_QUESTIONS_MESSAGE);
      }
      const open = await tx.theoryTestAttempt.findFirst({
        where: {
          testId,
          studentId: actor.id,
          organizationId: actor.organizationId,
          status: TheoryTestAttemptStatus.IN_PROGRESS,
        },
        select: { id: true, expiresAt: true },
      });
      if (open && !isAttemptExpired(open.expiresAt, now)) {
        throw attemptConflict(NextAttemptBlockReason.IN_PROGRESS, open.id);
      }
      if (open) {
        await tx.theoryTestAttempt.update({
          where: { id: open.id },
          data: {
            status: TheoryTestAttemptStatus.EXPIRED,
            submittedAt: now,
          },
        });
        this.logger.log(
          `Attempt expired attemptId=${open.id} testId=${testId} studentId=${actor.id} organizationId=${actor.organizationId}`,
        );
      }
      const slot = await this.nextSlot(tx, actor, test, now);
      let attempt: AttemptRow;
      try {
        attempt = await tx.theoryTestAttempt.create({
          data: this.attemptData(actor, test, now, slot),
          select: attemptSelect,
        });
      } catch (error) {
        if (isDuplicateOpenAttempt(error)) {
          throw new ConflictException({
            statusCode: 409,
            message: ATTEMPT_IN_PROGRESS_MESSAGE,
          });
        }
        throw error;
      }
      return this.attemptView(tx, actor.organizationId, attempt, now);
    });

    this.logger.log(
      `Attempt started attemptId=${created.id} testId=${testId} studentId=${actor.id} cycle=${created.cycle} attemptNumber=${created.attemptNumber} expiresAt=${created.expiresAt?.toISOString() ?? 'none'} organizationId=${actor.organizationId}`,
    );
    return created;
  }

  /**
   * Питання, варіанти і збережені відповіді цієї спроби: за цим запитом студент продовжує тест.
   * isCorrect немає, доки спробу не перевірено. Якщо дедлайн уже минув, спроба тут же закривається як EXPIRED.
   */
  async get(actor: User, attemptId: string): Promise<TestAttemptDto> {
    assertStudent(actor);
    await this.requireOrganization(actor.organizationId);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockOwnAttempt(tx, actor, attemptId);
      const current = await this.expireIfNeeded(tx, locked, now);
      if (current.status === TheoryTestAttemptStatus.IN_PROGRESS) {
        await this.assertCanContinue(
          tx,
          actor,
          current.courseId,
          current.testId,
        );
      }
      return this.attemptView(tx, actor.organizationId, current, now);
    });
  }

  /**
   * Зберігає проміжні відповіді відкритої спроби, щоб їх можна було відновити після перезавантаження.
   * Для кожного питання зі списку збережений вибір замінюється, решта питань лишається як була.
   * Правильність тут не перевіряється і не повертається. Закрита спроба відповідей не приймає (409).
   */
  async saveAnswers(
    actor: User,
    attemptId: string,
    payload: SaveAttemptAnswersDto,
  ): Promise<TestAttemptDto> {
    assertStudent(actor);
    await this.requireOrganization(actor.organizationId);
    const now = new Date();

    const outcome = await this.prisma.$transaction(
      async (tx): Promise<SaveOutcome> => {
        const locked = await this.lockOwnAttempt(tx, actor, attemptId);
        if (locked.status !== TheoryTestAttemptStatus.IN_PROGRESS) {
          return { closed: attemptApiStatus(locked.status) };
        }
        if (isAttemptExpired(locked.expiresAt, now)) {
          await this.markExpired(tx, locked, now);
          this.logger.log(
            `Attempt expired attemptId=${locked.id} testId=${locked.testId} studentId=${actor.id} organizationId=${actor.organizationId}`,
          );
          return { closed: AttemptApiStatus.EXPIRED };
        }
        await this.assertCanContinue(tx, actor, locked.courseId, locked.testId);
        assertFieldErrors(
          selectionErrors(snapshotQuestions(locked), payload.answers),
        );
        await this.writeAnswers(tx, locked, payload.answers, false);
        const saved = await tx.theoryTestAttempt.findFirst({
          where: { id: locked.id },
          select: attemptSelect,
        });
        if (!saved) {
          throw new NotFoundException(ATTEMPT_NOT_FOUND_MESSAGE);
        }
        return {
          attempt: await this.attemptView(tx, actor.organizationId, saved, now),
        };
      },
    );

    if ('closed' in outcome) {
      throw new ConflictException({
        statusCode: 409,
        message:
          outcome.closed === AttemptApiStatus.EXPIRED
            ? ATTEMPT_EXPIRED_MESSAGE
            : ATTEMPT_COMPLETED_MESSAGE,
        status: outcome.closed,
      });
    }
    return outcome.attempt;
  }

  /**
   * Перевіряє відповіді на сервері: бал, correctCount і PASSED/FAILED рахує лише він.
   * answers у тілі замінюють усі збережені; без answers перевіряється те, що збережено через PATCH answers.
   * Повтор submit тієї самої спроби повертає вже збережений результат і нічого не пише.
   * Після дедлайну відповіді відхиляються, а спроба стає EXPIRED без оцінки.
   * Провал не знімає позначку «урок пройдено»: нова спроба доступна, поки не витрачено всі спроби циклу.
   */
  async submit(
    actor: User,
    attemptId: string,
    payload: SubmitAttemptDto,
  ): Promise<TestAttemptDto> {
    assertStudent(actor);
    await this.requireOrganization(actor.organizationId);
    const now = new Date();
    let graded: {
      attemptId: string;
      testId: string;
      passed: boolean;
      correctCount: number;
      totalQuestions: number;
    } | null = null;

    const view = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockOwnAttempt(tx, actor, attemptId);
      if (locked.status !== TheoryTestAttemptStatus.IN_PROGRESS) {
        return this.attemptView(tx, actor.organizationId, locked, now);
      }
      if (isAttemptExpired(locked.expiresAt, now)) {
        const expired = await this.markExpired(tx, locked, now);
        this.logger.log(
          `Attempt expired attemptId=${locked.id} testId=${locked.testId} studentId=${actor.id} organizationId=${actor.organizationId}`,
        );
        return this.attemptView(tx, actor.organizationId, expired, now);
      }
      await this.assertCanContinue(tx, actor, locked.courseId, locked.testId);
      const snapshot = snapshotQuestions(locked);
      const submitted = payload.answers;
      if (submitted) {
        assertFieldErrors(selectionErrors(snapshot, submitted));
      }
      const grade = gradeAttempt(
        snapshot,
        submitted ?? savedAnswers(locked),
        locked.passingScore,
      );
      if (submitted) {
        await this.writeAnswers(tx, locked, submitted, true);
      }
      const status = grade.passed
        ? TheoryTestAttemptStatus.PASSED
        : TheoryTestAttemptStatus.FAILED;
      const updated = await tx.theoryTestAttempt.update({
        where: { id: locked.id },
        data: {
          status,
          score: grade.score,
          correctCount: grade.correctCount,
          totalQuestions: grade.totalQuestions,
          submittedAt: now,
        },
        select: attemptSelect,
      });
      if (!locked.test.courseLessonId) {
        await tx.theoryTestResult.upsert({
          where: {
            studentId_courseId: {
              studentId: actor.id,
              courseId: locked.courseId,
            },
          },
          create: {
            organizationId: actor.organizationId,
            courseId: locked.courseId,
            studentId: actor.id,
            testId: locked.testId,
            attemptId: locked.id,
            status: grade.passed
              ? TheoryTestStatus.PASSED
              : TheoryTestStatus.FAILED,
            score: grade.score,
            takenAt: now,
          },
          update: {
            testId: locked.testId,
            attemptId: locked.id,
            status: grade.passed
              ? TheoryTestStatus.PASSED
              : TheoryTestStatus.FAILED,
            score: grade.score,
            takenAt: now,
          },
        });
      }
      await syncTheoryCompletion(tx, actor.id, actor.organizationId);
      graded = {
        attemptId: locked.id,
        testId: locked.testId,
        passed: grade.passed,
        correctCount: grade.correctCount,
        totalQuestions: grade.totalQuestions,
      };
      this.logger.log(
        `Attempt submitted attemptId=${locked.id} testId=${locked.testId} studentId=${actor.id} status=${status} score=${grade.score} organizationId=${actor.organizationId}`,
      );
      return this.attemptView(tx, actor.organizationId, updated, now);
    });
    if (graded) {
      await this.notifications?.emit({
        kind: 'test.result',
        organizationId: actor.organizationId,
        actorId: actor.id,
        studentId: actor.id,
        attemptId: graded.attemptId,
        testId: graded.testId,
        passed: graded.passed,
        correctCount: graded.correctCount,
        totalQuestions: graded.totalQuestions,
      });
    }
    return view;
  }

  /**
   * Закриває спробу, якщо серверний дедлайн справді минув. Клієнтський таймер цього не вирішує:
   * до expiresAt спроба лишається IN_PROGRESS і повертається без змін. Уже закрита спроба — теж без змін.
   */
  async expire(actor: User, attemptId: string): Promise<TestAttemptDto> {
    assertStudent(actor);
    await this.requireOrganization(actor.organizationId);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockOwnAttempt(tx, actor, attemptId);
      const current = await this.expireIfNeeded(tx, locked, now);
      return this.attemptView(tx, actor.organizationId, current, now);
    });
  }

  /**
   * Мої спроби цього тесту за всі цикли і стан поточного: скільки спроб лишилося,
   * чи можна почати нову і яку відкриту спробу продовжити.
   */
  async listOwn(actor: User, testId: string): Promise<OwnTestAttemptsDto> {
    assertStudent(actor);
    await this.requireOrganization(actor.organizationId);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const test = await this.requireOutcomeTest(
        tx,
        actor.organizationId,
        testId,
      );
      await this.expireOwnOpen(tx, actor, testId, now);
      const history = await this.loadHistory(
        tx,
        actor.organizationId,
        testId,
        actor.id,
      );
      const canTake = await this.canTakeTest(tx, actor, test.courseId, test);
      if (history.length === 0 && !canTake) {
        await this.assertCanContinue(tx, actor, test.courseId, testId);
      }
      const lessonId = test.courseLessonId;
      const cycle = lessonId
        ? await this.currentCycle(tx, actor.organizationId, actor.id, lessonId)
        : 1;
      const decision = nextAttemptAvailability(
        test.maxAttempts,
        history,
        now,
        cycle,
      );
      const passed = history.some(
        (attempt) => attempt.status === TheoryTestAttemptStatus.PASSED,
      );
      let reason: NextAttemptBlockReason | null = passed
        ? NextAttemptBlockReason.ALREADY_PASSED
        : decision.unavailableReason;
      let available = decision.nextAttemptAvailable && !passed;
      const lessonOpen =
        !lessonId ||
        !canTake ||
        (await this.isLessonOpen(tx, actor, test.courseId, lessonId));
      if (
        (!canTake || !lessonOpen) &&
        (reason === null || reason === NextAttemptBlockReason.IN_PROGRESS)
      ) {
        available = false;
        reason = NextAttemptBlockReason.TEST_UNAVAILABLE;
      }
      const context: SummaryContext = {
        testId: test.id,
        courseId: test.courseId,
        lessonId,
      };
      return {
        testId: test.id,
        lessonId,
        maxAttempts: test.maxAttempts,
        cycle,
        passed,
        attemptsUsed: decision.attemptsStarted,
        attemptsLeft: decision.attemptsRemaining,
        nextAttemptAvailable: available,
        unavailableReason: reason,
        openAttemptId: decision.openAttemptId,
        ...(lessonId &&
        !passed &&
        reason === NextAttemptBlockReason.ATTEMPTS_EXHAUSTED
          ? { message: LESSON_RETRY_MESSAGE }
          : {}),
        attempts: [...history]
          .sort(
            (left, right) =>
              right.startedAt.getTime() - left.startedAt.getTime(),
          )
          .map((attempt) => toSummary(attempt, context)),
      };
    });
  }

  /** Усі мої спроби по всіх тестах, від новішої, зі сторінками. */
  async listMyAttempts(
    actor: User,
    query: MyTestAttemptsQueryDto = {},
  ): Promise<MyTestAttemptListDto> {
    assertStudent(actor);
    await this.requireOrganization(actor.organizationId);
    const now = new Date();
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;

    await this.expireOverdue(
      { organizationId: actor.organizationId, studentId: actor.id },
      now,
    );
    const where: Prisma.TheoryTestAttemptWhereInput = {
      organizationId: actor.organizationId,
      studentId: actor.id,
      ...(query.testId ? { testId: query.testId } : {}),
      ...(query.lessonId ? { test: { courseLessonId: query.lessonId } } : {}),
      ...statusFilter(query.status, query.result),
    };
    const [total, rows] = await Promise.all([
      this.prisma.theoryTestAttempt.count({ where }),
      this.prisma.theoryTestAttempt.findMany({
        where,
        select: listSelect,
        orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      attempts: rows.map((row) => toListSummary(row)),
      pagination: paginate(total, page, limit),
    };
  }

  /**
   * Спроби студентів цього тесту. ADMIN бачить усю свою автошколу, TEACHER — лише студентів своїх груп
   * на курсі тесту (інакше 403, якщо курс не призначено жодній його групі).
   */
  listForTest(
    actor: User,
    testId: string,
    query: StaffTestAttemptsQueryDto = {},
  ): Promise<StaffTestAttemptListDto> {
    return this.listStaffAttempts(actor, testId, query);
  }

  /**
   * Спроби студентів по всіх тестах автошколи з фільтрами groupId, studentId і testId.
   * TEACHER бачить лише студентів своїх груп на курсах цих груп.
   */
  listAttempts(
    actor: User,
    query: StaffAllTestAttemptsQueryDto = {},
  ): Promise<StaffTestAttemptListDto> {
    return this.listStaffAttempts(actor, query.testId, query);
  }

  /**
   * Дозволений результат цього студента: бал, passed/failed і чи можна почати ще одну спробу.
   * Правильні відповіді сюди не входять. Їх відкриває перегляд уже перевіреної спроби.
   */
  async getOwnResult(actor: User, testId: string): Promise<TestOutcomeDto> {
    assertStudent(actor);
    await this.requireOrganization(actor.organizationId);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const test = await this.requireOutcomeTest(
        tx,
        actor.organizationId,
        testId,
      );
      await this.expireOwnOpen(tx, actor, testId, now);
      const history = await this.loadHistory(
        tx,
        actor.organizationId,
        testId,
        actor.id,
      );
      const canTake = await this.canTakeTest(tx, actor, test.courseId, test);
      if (history.length === 0 && !canTake) {
        await this.assertCanContinue(tx, actor, test.courseId, testId);
      }
      const cycle = test.courseLessonId
        ? await this.currentCycle(
            tx,
            actor.organizationId,
            actor.id,
            test.courseLessonId,
          )
        : undefined;
      return toOutcome(test, actor.id, history, now, canTake, cycle);
    });
  }

  /**
   * Результати студентів курсу цього тесту.
   * ADMIN бачить зарахованих своєї автошколи. TEACHER — лише свою групу.
   */
  async listResults(
    actor: User,
    testId: string,
  ): Promise<StaffTestResultListDto> {
    assertCanReadResults(actor);
    await this.requireOrganization(actor.organizationId);
    const now = new Date();
    const test = await this.requireOutcomeTest(
      this.prisma,
      actor.organizationId,
      testId,
    );
    const students = await this.visibleStudents(actor, test.courseId);
    if (students.size === 0) {
      return { results: [] };
    }
    const courseOpen = await this.courseOpenForAttempts(
      this.prisma,
      actor.organizationId,
      test.courseId,
    );
    await this.expireOverdue(
      { organizationId: actor.organizationId, testId },
      now,
    );
    const attempts = await this.prisma.theoryTestAttempt.findMany({
      where: {
        testId,
        organizationId: actor.organizationId,
        studentId: { in: [...students.keys()] },
      },
      select: historySelect,
      orderBy: { startedAt: 'desc' },
    });
    const cycles = test.courseLessonId
      ? await this.cyclesFor(
          this.prisma,
          actor.organizationId,
          test.courseLessonId,
          [...students.keys()],
        )
      : null;
    const byStudent = new Map<string, HistoryRow[]>();
    for (const attempt of attempts) {
      const list = byStudent.get(attempt.studentId) ?? [];
      list.push(attempt);
      byStudent.set(attempt.studentId, list);
    }
    const testOpen =
      courseOpen &&
      test.publicationStatus === TheoryTestPublicationStatus.PUBLISHED &&
      test.questions.length > 0;
    const results = [...byStudent.entries()]
      .map(([studentId, history]) => {
        const person = students.get(studentId);
        if (!person) {
          return null;
        }
        return {
          ...toOutcome(
            test,
            studentId,
            history,
            now,
            testOpen && person.active,
            cycles ? (cycles.get(studentId) ?? 1) : undefined,
          ),
          firstName: person.firstName,
          lastName: person.lastName,
          attempts: toAttemptSummaries(history),
        };
      })
      .filter((row): row is StaffTestResultDto => row !== null)
      .sort((left, right) => left.lastName.localeCompare(right.lastName, 'uk'));
    return { results };
  }

  /**
   * Результат одного студента. Чужий студент викладача — 403, якщо він на цьому курсі в іншій групі.
   * Студент або тест іншої автошколи — 404.
   */
  async getStudentResult(
    actor: User,
    testId: string,
    studentId: string,
  ): Promise<StaffTestResultDto> {
    assertCanReadResults(actor);
    await this.requireOrganization(actor.organizationId);
    const now = new Date();
    const test = await this.requireOutcomeTest(
      this.prisma,
      actor.organizationId,
      testId,
    );
    const person = await this.requireVisibleStudent(
      actor,
      test.courseId,
      studentId,
    );
    await this.expireOverdue(
      { organizationId: actor.organizationId, testId, studentId },
      now,
    );
    const history = await this.loadHistory(
      this.prisma,
      actor.organizationId,
      testId,
      studentId,
    );
    const canTake = await this.canTakeTest(
      this.prisma,
      { ...actor, id: studentId, role: UserRole.STUDENT },
      test.courseId,
      test,
    );
    const cycle = test.courseLessonId
      ? await this.currentCycle(
          this.prisma,
          actor.organizationId,
          studentId,
          test.courseLessonId,
        )
      : undefined;
    return {
      ...toOutcome(test, studentId, history, now, canTake, cycle),
      firstName: person.firstName,
      lastName: person.lastName,
      attempts: toAttemptSummaries(history),
    };
  }

  private async listStaffAttempts(
    actor: User,
    testId: string | undefined,
    query: StaffTestAttemptsQueryDto,
  ): Promise<StaffTestAttemptListDto> {
    assertCanReadResults(actor);
    await this.requireOrganization(actor.organizationId);
    const now = new Date();
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const isTeacher = actor.role === UserRole.TEACHER;

    let testCourseId: string | null = null;
    if (testId) {
      const test = await this.requireOutcomeTest(
        this.prisma,
        actor.organizationId,
        testId,
      );
      testCourseId = test.courseId;
    }
    if (query.groupId) {
      const group = await this.prisma.group.findFirst({
        where: { id: query.groupId, organizationId: actor.organizationId },
        select: { id: true, teacherId: true },
      });
      if (!group) {
        throw new NotFoundException(GROUP_NOT_FOUND_MESSAGE);
      }
      if (isTeacher && group.teacherId !== actor.id) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    const scopeGroups =
      isTeacher || query.groupId
        ? await this.prisma.group.findMany({
            where: {
              organizationId: actor.organizationId,
              courseId: testCourseId ?? { not: null },
              ...(isTeacher ? { teacherId: actor.id } : {}),
              ...(query.groupId ? { id: query.groupId } : {}),
            },
            select: { id: true, courseId: true },
          })
        : null;
    if (scopeGroups && scopeGroups.length === 0) {
      if (testId && isTeacher && !query.groupId) {
        throw new ForbiddenException('Insufficient permissions');
      }
      return { attempts: [], pagination: paginate(0, page, limit) };
    }

    await this.expireOverdue(
      { organizationId: actor.organizationId, ...(testId ? { testId } : {}) },
      now,
    );
    const where: Prisma.TheoryTestAttemptWhereInput = {
      organizationId: actor.organizationId,
      ...(testId ? { testId } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...statusFilter(query.status, query.result),
      AND: [
        { student: { role: UserRole.STUDENT, deletedAt: null } },
        ...(scopeGroups
          ? [
              {
                OR: scopeGroups.map((group) => ({
                  courseId: group.courseId,
                  student: {
                    enrollments: {
                      some: {
                        groupId: group.id,
                        status: { in: [...VISIBLE_ENROLLMENT] },
                      },
                    },
                  },
                })),
              },
            ]
          : []),
      ],
    };
    const [total, rows] = await Promise.all([
      this.prisma.theoryTestAttempt.count({ where }),
      this.prisma.theoryTestAttempt.findMany({
        where,
        select: listSelect,
        orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    const groups = await this.groupsFor(actor, rows, query.groupId);
    return {
      attempts: rows.map((row) =>
        toStaffAttempt(
          row,
          groups.get(`${row.studentId}:${row.courseId}`) ?? null,
        ),
      ),
      pagination: paginate(total, page, limit),
    };
  }

  /** Група студента на курсі кожної спроби. ACTIVE зарахування важливіше за COMPLETED. */
  private async groupsFor(
    actor: User,
    rows: ListRow[],
    groupId?: string,
  ): Promise<Map<string, { id: string; name: string }>> {
    const found = new Map<string, { id: string; name: string }>();
    if (rows.length === 0) {
      return found;
    }
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        studentId: { in: [...new Set(rows.map((row) => row.studentId))] },
        status: { in: [...VISIBLE_ENROLLMENT] },
        group: {
          organizationId: actor.organizationId,
          courseId: { in: [...new Set(rows.map((row) => row.courseId))] },
          ...(actor.role === UserRole.TEACHER ? { teacherId: actor.id } : {}),
          ...(groupId ? { id: groupId } : {}),
        },
      },
      select: {
        studentId: true,
        status: true,
        group: { select: { id: true, name: true, courseId: true } },
      },
    });
    const activeKeys = new Set<string>();
    for (const enrollment of enrollments) {
      if (!enrollment.group.courseId) {
        continue;
      }
      const key = `${enrollment.studentId}:${enrollment.group.courseId}`;
      const active = enrollment.status === EnrollmentStatus.ACTIVE;
      if (found.has(key) && (activeKeys.has(key) || !active)) {
        continue;
      }
      found.set(key, {
        id: enrollment.group.id,
        name: enrollment.group.name,
      });
      if (active) {
        activeKeys.add(key);
      }
    }
    return found;
  }

  /**
   * Цикл і номер наступної спроби. Для уроку це поточний цикл студента й слоти, що вже зайняті;
   * без уроку (старий тест курсу) цикл завжди 1. Закритий урок — 403, вичерпані спроби — 409.
   */
  private async nextSlot(
    tx: Prisma.TransactionClient,
    actor: User,
    test: CatalogTest,
    now: Date,
  ): Promise<AttemptSlot> {
    const lessonId = test.courseLessonId;
    if (!lessonId) {
      const history = await tx.theoryTestAttempt.findMany({
        where: {
          testId: test.id,
          studentId: actor.id,
          organizationId: actor.organizationId,
        },
        select: historySelect,
      });
      const decision = nextAttemptAvailability(test.maxAttempts, history, now);
      if (!decision.nextAttemptAvailable) {
        throw attemptConflict(
          decision.unavailableReason ??
            NextAttemptBlockReason.ATTEMPTS_EXHAUSTED,
          decision.openAttemptId,
        );
      }
      return { cycle: 1, attemptNumber: decision.attemptsStarted + 1 };
    }
    const gate = await loadLessonGate(
      tx,
      actor.organizationId,
      test.courseId,
      actor.id,
      now,
    );
    if (
      !gate.ordered.some((lesson) => lesson.id === lessonId) ||
      gate.locked.has(lessonId)
    ) {
      throw new ForbiddenException(LESSON_LOCKED_MESSAGE);
    }
    const state = gate.tests.get(lessonId);
    if (!state || state.testId !== test.id) {
      throw new ForbiddenException(TEST_NOT_PUBLISHED_MESSAGE);
    }
    if (!state.nextAttemptAvailable) {
      throw attemptConflict(
        state.unavailableReason ?? NextAttemptBlockReason.ATTEMPTS_EXHAUSTED,
        state.openAttemptId,
        true,
      );
    }
    return { cycle: state.cycle, attemptNumber: state.attemptsUsed + 1 };
  }

  private async isLessonOpen(
    db: Db,
    actor: User,
    courseId: string,
    lessonId: string,
  ): Promise<boolean> {
    const gate = await loadLessonGate(
      db,
      actor.organizationId,
      courseId,
      actor.id,
    );
    return (
      gate.ordered.some((lesson) => lesson.id === lessonId) &&
      !gate.locked.has(lessonId)
    );
  }

  /** Поточний цикл спроб студента в уроку: 1, доки він не проходив урок повторно після вичерпаних спроб. */
  private async currentCycle(
    db: Db,
    organizationId: string,
    studentId: string,
    lessonId: string,
  ): Promise<number> {
    const completion = await db.courseLessonCompletion.findFirst({
      where: { organizationId, studentId, lessonId },
      select: { testCycle: true },
    });
    return completion?.testCycle ?? 1;
  }

  private async cyclesFor(
    db: Db,
    organizationId: string,
    lessonId: string,
    studentIds: string[],
  ): Promise<Map<string, number>> {
    const rows = await db.courseLessonCompletion.findMany({
      where: { organizationId, lessonId, studentId: { in: studentIds } },
      select: { studentId: true, testCycle: true },
    });
    return new Map(rows.map((row) => [row.studentId, row.testCycle]));
  }

  /**
   * Спроба для відповіді клієнту: лічильники рахуються за її власним циклом.
   * Повідомлення «Пройдіть урок ще раз.» є, коли спроби циклу вичерпано, тест не складено
   * і студент ще не починав новий цикл.
   */
  private async attemptView(
    db: Db,
    organizationId: string,
    attempt: AttemptRow,
    now: Date,
  ): Promise<TestAttemptDto> {
    const history = await db.theoryTestAttempt.findMany({
      where: {
        organizationId,
        testId: attempt.testId,
        studentId: attempt.studentId,
      },
      select: historySelect,
    });
    const decision = nextAttemptAvailability(
      attempt.test.maxAttempts,
      history,
      now,
      attempt.cycle,
    );
    let message: string | undefined;
    const lessonId = attempt.test.courseLessonId;
    if (
      lessonId &&
      decision.unavailableReason === NextAttemptBlockReason.ATTEMPTS_EXHAUSTED
    ) {
      const cycle = await this.currentCycle(
        db,
        organizationId,
        attempt.studentId,
        lessonId,
      );
      if (attempt.cycle >= cycle) {
        message = LESSON_RETRY_MESSAGE;
      }
    }
    return toTestAttempt(
      attempt,
      {
        attemptsUsed: decision.attemptsStarted,
        attemptsLeft: decision.attemptsRemaining,
      },
      message,
    );
  }

  private attemptData(
    actor: User,
    test: CatalogTest,
    now: Date,
    slot: AttemptSlot,
  ) {
    const ordered = test.shuffleQuestions
      ? shuffleInPlace(test.questions)
      : test.questions;
    return {
      organizationId: actor.organizationId,
      courseId: test.courseId,
      testId: test.id,
      studentId: actor.id,
      status: TheoryTestAttemptStatus.IN_PROGRESS,
      format: test.format,
      cycle: slot.cycle,
      attemptNumber: slot.attemptNumber,
      startedAt: now,
      expiresAt: attemptDeadline(now, test.timeLimitMinutes),
      passingScore: test.passingScore,
      timeLimitMinutes: test.timeLimitMinutes,
      questions: {
        create: ordered.map((question, index) => ({
          sourceQuestionId: question.id,
          type: question.type,
          text: question.text,
          position: index + 1,
          options: {
            create: question.options.map((option) => ({
              sourceOptionId: option.id,
              text: option.text,
              isCorrect: option.isCorrect,
              position: option.position,
            })),
          },
        })),
      },
    };
  }

  /**
   * Пише вибір студента. replaceAll стирає всі збережені відповіді (submit із answers),
   * інакше замінюються лише відповіді на питання зі списку (проміжне збереження).
   */
  private async writeAnswers(
    tx: Prisma.TransactionClient,
    attempt: AttemptRow,
    answers: AnswerSelection[],
    replaceAll: boolean,
  ): Promise<void> {
    const questions = new Map(
      attempt.questions.map((question) => [
        question.sourceQuestionId,
        question,
      ]),
    );
    if (replaceAll) {
      await tx.theoryTestAttemptAnswer.deleteMany({
        where: { attemptId: attempt.id },
      });
    } else {
      const touched = answers
        .map((answer) => questions.get(answer.questionId)?.id)
        .filter((id): id is string => id !== undefined);
      if (touched.length > 0) {
        await tx.theoryTestAttemptAnswer.deleteMany({
          where: { attemptId: attempt.id, questionId: { in: touched } },
        });
      }
    }
    for (const answer of answers) {
      if (answer.optionIds.length === 0) {
        continue;
      }
      const question = questions.get(answer.questionId);
      if (!question) {
        continue;
      }
      const options = new Map(
        question.options.map((option) => [option.sourceOptionId, option.id]),
      );
      await tx.theoryTestAttemptAnswer.create({
        data: {
          attemptId: attempt.id,
          questionId: question.id,
          selections: {
            create: answer.optionIds.map((optionId) => {
              const snapshotOptionId = options.get(optionId);
              if (!snapshotOptionId) {
                throw fieldBadRequest(
                  'optionIds',
                  'Варіант не належить цьому питанню.',
                );
              }
              // questionId тут не передається: Prisma бере його з відповіді через складений FK,
              // а FK (optionId, questionId) у базі не дає обрати варіант іншого питання.
              return { optionId: snapshotOptionId };
            }),
          },
        },
      });
    }
  }

  private async expireIfNeeded(
    tx: Prisma.TransactionClient,
    attempt: AttemptRow,
    now: Date,
  ): Promise<AttemptRow> {
    if (
      attempt.status !== TheoryTestAttemptStatus.IN_PROGRESS ||
      !isAttemptExpired(attempt.expiresAt, now)
    ) {
      return attempt;
    }
    const expired = await this.markExpired(tx, attempt, now);
    this.logger.log(
      `Attempt expired attemptId=${attempt.id} testId=${attempt.testId} studentId=${attempt.studentId}`,
    );
    return expired;
  }

  private markExpired(
    tx: Prisma.TransactionClient,
    attempt: AttemptRow,
    now: Date,
  ): Promise<AttemptRow> {
    return tx.theoryTestAttempt.update({
      where: { id: attempt.id },
      data: {
        status: TheoryTestAttemptStatus.EXPIRED,
        submittedAt: now,
      },
      select: attemptSelect,
    });
  }

  private async lockStart(
    tx: Prisma.TransactionClient,
    studentId: string,
    testId: string,
  ): Promise<void> {
    const key = `test-attempt:${studentId}:${testId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}::text, 0))`;
  }

  /** Блокує рядок своєї спроби. Чужа або неіснуюча — 404. */
  private async lockOwnAttempt(
    tx: Prisma.TransactionClient,
    actor: User,
    attemptId: string,
  ): Promise<AttemptRow> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM theory_test_attempts
      WHERE id = ${attemptId}::uuid
        AND student_id = ${actor.id}::uuid
        AND organization_id = ${actor.organizationId}::uuid
      FOR UPDATE
    `;
    if (rows.length === 0) {
      throw new NotFoundException(ATTEMPT_NOT_FOUND_MESSAGE);
    }
    const attempt = await tx.theoryTestAttempt.findFirst({
      where: { id: attemptId },
      select: attemptSelect,
    });
    if (!attempt) {
      throw new NotFoundException(ATTEMPT_NOT_FOUND_MESSAGE);
    }
    return attempt;
  }

  private async assertCanContinue(
    tx: Prisma.TransactionClient,
    actor: User,
    courseId: string,
    testId: string,
  ): Promise<void> {
    const test = await tx.theoryTest.findFirst({
      where: { id: testId, organizationId: actor.organizationId },
      select: { publicationStatus: true },
    });
    if (!test) {
      throw new NotFoundException(TEST_NOT_FOUND_MESSAGE);
    }
    if (test.publicationStatus !== TheoryTestPublicationStatus.PUBLISHED) {
      throw new ForbiddenException(TEST_NOT_PUBLISHED_MESSAGE);
    }
    await this.requireAssignedPublishedCourse(tx, actor, courseId);
  }

  private async requireAssignedPublishedCourse(
    tx: Prisma.TransactionClient,
    actor: User,
    courseId: string,
  ): Promise<void> {
    const course = await tx.course.findFirst({
      where: { id: courseId, organizationId: actor.organizationId },
      select: { id: true, status: true, publicationStatus: true },
    });
    if (!course) {
      throw new NotFoundException(COURSE_NOT_FOUND_MESSAGE);
    }
    const enrollment = await tx.enrollment.findFirst({
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
      course.publicationStatus !== CoursePublicationStatus.PUBLISHED ||
      course.status !== CourseStatus.ACTIVE
    ) {
      throw new ForbiddenException(COURSE_NOT_PUBLISHED_MESSAGE);
    }
  }

  private async requireOutcomeTest(
    db: Db,
    organizationId: string,
    testId: string,
  ): Promise<OutcomeTest> {
    const test = await db.theoryTest.findFirst({
      where: { id: testId, organizationId },
      select: outcomeSelect,
    });
    if (!test) {
      throw new NotFoundException(TEST_NOT_FOUND_MESSAGE);
    }
    return test;
  }

  private async expireOwnOpen(
    tx: Prisma.TransactionClient,
    actor: User,
    testId: string,
    now: Date,
  ): Promise<void> {
    const open = await tx.theoryTestAttempt.findFirst({
      where: {
        testId,
        studentId: actor.id,
        organizationId: actor.organizationId,
        status: TheoryTestAttemptStatus.IN_PROGRESS,
      },
      select: { id: true, expiresAt: true },
    });
    if (!open || !isAttemptExpired(open.expiresAt, now)) {
      return;
    }
    await tx.theoryTestAttempt.update({
      where: { id: open.id },
      data: {
        status: TheoryTestAttemptStatus.EXPIRED,
        submittedAt: now,
      },
    });
    this.logger.log(
      `Attempt expired attemptId=${open.id} testId=${testId} studentId=${actor.id} organizationId=${actor.organizationId}`,
    );
  }

  /** Закриває прострочені відкриті спроби перед читанням списків, щоб статус у них був правдивий. */
  private expireOverdue(
    scope: { organizationId: string; testId?: string; studentId?: string },
    now: Date,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.theoryTestAttempt.updateMany({
      where: {
        organizationId: scope.organizationId,
        ...(scope.testId ? { testId: scope.testId } : {}),
        ...(scope.studentId ? { studentId: scope.studentId } : {}),
        status: TheoryTestAttemptStatus.IN_PROGRESS,
        expiresAt: { lte: now },
      },
      data: {
        status: TheoryTestAttemptStatus.EXPIRED,
        submittedAt: now,
      },
    });
  }

  private loadHistory(
    db: Db,
    organizationId: string,
    testId: string,
    studentId: string,
  ): Promise<HistoryRow[]> {
    return db.theoryTestAttempt.findMany({
      where: { organizationId, testId, studentId },
      select: historySelect,
      orderBy: { startedAt: 'desc' },
    });
  }

  private async courseOpenForAttempts(
    db: Db,
    organizationId: string,
    courseId: string,
  ): Promise<boolean> {
    const course = await db.course.findFirst({
      where: { id: courseId, organizationId },
      select: { status: true, publicationStatus: true },
    });
    return (
      course?.publicationStatus === CoursePublicationStatus.PUBLISHED &&
      course.status === CourseStatus.ACTIVE
    );
  }

  private async canTakeTest(
    db: Db,
    actor: User,
    courseId: string,
    test: OutcomeTest,
  ): Promise<boolean> {
    if (
      test.publicationStatus !== TheoryTestPublicationStatus.PUBLISHED ||
      test.questions.length === 0
    ) {
      return false;
    }
    if (
      !(await this.courseOpenForAttempts(db, actor.organizationId, courseId))
    ) {
      return false;
    }
    const enrollment = await db.enrollment.findFirst({
      where: {
        studentId: actor.id,
        status: EnrollmentStatus.ACTIVE,
        group: { organizationId: actor.organizationId, courseId },
      },
      select: { id: true },
    });
    return enrollment !== null;
  }

  private async visibleStudents(
    actor: User,
    courseId: string,
  ): Promise<Map<string, VisibleStudent>> {
    const rows = await this.prisma.enrollment.findMany({
      where: {
        status: { in: [...VISIBLE_ENROLLMENT] },
        student: {
          organizationId: actor.organizationId,
          role: UserRole.STUDENT,
          deletedAt: null,
        },
        group: {
          organizationId: actor.organizationId,
          courseId,
          ...(actor.role === UserRole.TEACHER ? { teacherId: actor.id } : {}),
        },
      },
      select: {
        studentId: true,
        status: true,
        student: { select: { firstName: true, lastName: true } },
      },
    });
    const students = new Map<string, VisibleStudent>();
    for (const row of rows) {
      const active = row.status === EnrollmentStatus.ACTIVE;
      const current = students.get(row.studentId);
      if (!current || (active && !current.active)) {
        students.set(row.studentId, {
          firstName: row.student.firstName,
          lastName: row.student.lastName,
          active,
        });
      }
    }
    return students;
  }

  private async requireVisibleStudent(
    actor: User,
    courseId: string,
    studentId: string,
  ): Promise<VisibleStudent> {
    const student = await this.prisma.user.findFirst({
      where: {
        id: studentId,
        organizationId: actor.organizationId,
        role: UserRole.STUDENT,
        deletedAt: null,
      },
      select: { firstName: true, lastName: true },
    });
    if (!student) {
      throw new NotFoundException('Student not found');
    }
    if (actor.role === UserRole.TEACHER) {
      const ownGroup = await this.prisma.enrollment.findFirst({
        where: {
          studentId,
          status: { in: [...VISIBLE_ENROLLMENT] },
          group: {
            organizationId: actor.organizationId,
            courseId,
            teacherId: actor.id,
          },
        },
        select: { status: true },
      });
      if (ownGroup) {
        return {
          firstName: student.firstName,
          lastName: student.lastName,
          active: ownGroup.status === EnrollmentStatus.ACTIVE,
        };
      }
    }
    const assigned = await this.prisma.enrollment.findFirst({
      where: {
        studentId,
        status: { in: [...VISIBLE_ENROLLMENT] },
        group: { organizationId: actor.organizationId, courseId },
      },
      select: { status: true },
    });
    if (!assigned) {
      throw new NotFoundException(TEST_RESULT_NOT_FOUND_MESSAGE);
    }
    if (actor.role === UserRole.TEACHER) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return {
      firstName: student.firstName,
      lastName: student.lastName,
      active: assigned.status === EnrollmentStatus.ACTIVE,
    };
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
