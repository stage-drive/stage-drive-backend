import {
  ConflictException,
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
  TheoryTestAttemptStatus,
  TheoryTestPublicationStatus,
  TheoryTestStatus,
  User,
  UserRole,
} from '@prisma/client';
import { fieldBadRequest } from '../../common/validation/field-error';
import { PrismaService } from '../../prisma/prisma.service';
import { syncTheoryCompletion } from '../students/theory-completion';
import {
  COURSE_NOT_FOUND_MESSAGE,
  COURSE_NOT_PUBLISHED_MESSAGE,
} from '../courses/courses.service';
import {
  AttemptDetailDto,
  AttemptOptionDto,
  AttemptQuestionDto,
  StaffAttemptSummaryDto,
  StaffTestResultDto,
  StaffTestResultListDto,
  SubmitAttemptDto,
  TestOutcomeDto,
  TestScoreDto,
} from './test-attempts.dto';
import {
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
export const TEST_RESULT_NOT_FOUND_MESSAGE = 'Test result not found';

export const TEST_RESULT_STAFF_ROLES = [
  UserRole.ADMIN,
  UserRole.TEACHER,
] as const;

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
  publicationStatus: true,
  questions: {
    orderBy: { position: 'asc' as const },
    select: {
      id: true,
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
  format: true,
  startedAt: true,
  expiresAt: true,
  submittedAt: true,
  score: true,
  passingScore: true,
  timeLimitMinutes: true,
  questions: {
    orderBy: { position: 'asc' as const },
    select: {
      id: true,
      sourceQuestionId: true,
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
} satisfies Prisma.TheoryTestAttemptSelect;

const outcomeSelect = {
  id: true,
  courseId: true,
  passingScore: true,
  maxAttempts: true,
  publicationStatus: true,
  questions: { select: { id: true }, take: 1 },
} satisfies Prisma.TheoryTestSelect;

type HistoryRow = Prisma.TheoryTestAttemptGetPayload<{
  select: typeof historySelect;
}>;
type OutcomeTest = Prisma.TheoryTestGetPayload<{
  select: typeof outcomeSelect;
}>;
type VisibleStudent = {
  firstName: string;
  lastName: string;
  active: boolean;
};

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

function revealsAnswers(status: TheoryTestAttemptStatus): boolean {
  return (
    status === TheoryTestAttemptStatus.PASSED ||
    status === TheoryTestAttemptStatus.FAILED
  );
}

function attemptConflict(
  reason: NextAttemptBlockReason,
  attemptId: string | null,
): ConflictException {
  const message =
    reason === NextAttemptBlockReason.IN_PROGRESS
      ? ATTEMPT_IN_PROGRESS_MESSAGE
      : reason === NextAttemptBlockReason.ALREADY_PASSED
        ? ALREADY_PASSED_MESSAGE
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

function toOutcome(
  test: OutcomeTest,
  studentId: string,
  history: HistoryRow[],
  now: Date,
  canTake: boolean,
): TestOutcomeDto {
  const decision = nextAttemptAvailability(test.maxAttempts, history, now);
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
    text: question.text,
    position: question.position,
    options: question.options.map((option) =>
      toOption(option, reveal, selectedIds),
    ),
  };
}

/** До PASSED/FAILED студент не бачить isCorrect і власні позначки. */
function toAttempt(attempt: AttemptRow): AttemptDetailDto {
  const reveal = revealsAnswers(attempt.status);
  return {
    id: attempt.id,
    testId: attempt.testId,
    courseId: attempt.courseId,
    studentId: attempt.studentId,
    status: attempt.status,
    format: attempt.format,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    submittedAt: attempt.submittedAt,
    score: reveal ? attempt.score : null,
    passingScore: attempt.passingScore,
    timeLimitMinutes: attempt.timeLimitMinutes,
    questions: attempt.questions.map((question) =>
      toQuestion(question, reveal),
    ),
  };
}

@Injectable()
export class TestAttemptsService {
  private readonly logger = new Logger(TestAttemptsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Починає спробу. Кожен успішний старт пише новий рядок.
   * Незавершена і ще не прострочена спроба цього тесту не дублюється.
   */
  async start(actor: User, testId: string): Promise<AttemptDetailDto> {
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
      const history = await tx.theoryTestAttempt.findMany({
        where: {
          testId,
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
      try {
        return await tx.theoryTestAttempt.create({
          data: this.attemptData(actor, test, now),
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
    });

    this.logger.log(
      `Attempt started attemptId=${created.id} testId=${testId} studentId=${actor.id} expiresAt=${created.expiresAt?.toISOString() ?? 'none'} organizationId=${actor.organizationId}`,
    );
    return toAttempt(created);
  }

  /**
   * Питання і варіанти цієї спроби. isCorrect немає, доки спробу не перевірено.
   * Якщо дедлайн уже минув, спроба тут же закривається як EXPIRED.
   */
  async get(
    actor: User,
    testId: string,
    attemptId: string,
  ): Promise<AttemptDetailDto> {
    assertStudent(actor);
    await this.requireOrganization(actor.organizationId);
    const now = new Date();

    const attempt = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockOwnAttempt(tx, actor, testId, attemptId);
      const current = await this.expireIfNeeded(tx, locked, now);
      if (current.status === TheoryTestAttemptStatus.IN_PROGRESS) {
        await this.assertCanContinue(tx, actor, current.courseId, testId);
      }
      return current;
    });
    return toAttempt(attempt);
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
      return toOutcome(test, actor.id, history, now, canTake);
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
    await this.expireOverdue(actor.organizationId, testId, now);
    const attempts = await this.prisma.theoryTestAttempt.findMany({
      where: {
        testId,
        organizationId: actor.organizationId,
        studentId: { in: [...students.keys()] },
      },
      select: historySelect,
      orderBy: { startedAt: 'desc' },
    });
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
    await this.expireOverdue(actor.organizationId, testId, now, studentId);
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
    return {
      ...toOutcome(test, studentId, history, now, canTake),
      firstName: person.firstName,
      lastName: person.lastName,
      attempts: toAttemptSummaries(history),
    };
  }

  /**
   * Перевіряє відповіді на сервері. Повтор того самого submit не пише другий результат.
   * Після дедлайну відповіді відхиляються, а спроба стає EXPIRED.
   */
  async submit(
    actor: User,
    testId: string,
    attemptId: string,
    payload: SubmitAttemptDto,
  ): Promise<AttemptDetailDto> {
    assertStudent(actor);
    await this.requireOrganization(actor.organizationId);
    const now = new Date();

    const saved = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockOwnAttempt(tx, actor, testId, attemptId);
      if (locked.status !== TheoryTestAttemptStatus.IN_PROGRESS) {
        return locked;
      }
      if (isAttemptExpired(locked.expiresAt, now)) {
        const expired = await this.markExpired(tx, locked, now);
        this.logger.log(
          `Attempt expired attemptId=${locked.id} testId=${testId} studentId=${actor.id} organizationId=${actor.organizationId}`,
        );
        return expired;
      }
      await this.assertCanContinue(tx, actor, locked.courseId, testId);
      assertFieldErrors(
        selectionErrors(
          locked.format,
          locked.questions.map((question) => ({
            id: question.sourceQuestionId,
            options: question.options.map((option) => ({
              id: option.sourceOptionId,
            })),
          })),
          payload.answers,
        ),
      );
      const { score, passed } = gradeAttempt(
        locked.questions.map((question) => ({
          id: question.sourceQuestionId,
          options: question.options.map((option) => ({
            id: option.sourceOptionId,
            isCorrect: option.isCorrect,
          })),
        })),
        payload.answers,
        locked.passingScore,
      );
      await this.writeAnswers(tx, locked, payload.answers);
      const status = passed
        ? TheoryTestAttemptStatus.PASSED
        : TheoryTestAttemptStatus.FAILED;
      const updated = await tx.theoryTestAttempt.update({
        where: { id: locked.id },
        data: { status, score, submittedAt: now },
        select: attemptSelect,
      });
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
          status: passed ? TheoryTestStatus.PASSED : TheoryTestStatus.FAILED,
          score,
          takenAt: now,
        },
        update: {
          testId: locked.testId,
          attemptId: locked.id,
          status: passed ? TheoryTestStatus.PASSED : TheoryTestStatus.FAILED,
          score,
          takenAt: now,
        },
      });
      await syncTheoryCompletion(tx, actor.id, actor.organizationId);
      this.logger.log(
        `Attempt submitted attemptId=${locked.id} testId=${testId} studentId=${actor.id} status=${status} score=${score} organizationId=${actor.organizationId}`,
      );
      return updated;
    });
    return toAttempt(saved);
  }

  private attemptData(actor: User, test: CatalogTest, now: Date) {
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
      startedAt: now,
      expiresAt: attemptDeadline(now, test.timeLimitMinutes),
      passingScore: test.passingScore,
      timeLimitMinutes: test.timeLimitMinutes,
      questions: {
        create: ordered.map((question, index) => ({
          sourceQuestionId: question.id,
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

  private async writeAnswers(
    tx: Prisma.TransactionClient,
    attempt: AttemptRow,
    answers: SubmitAttemptDto['answers'],
  ): Promise<void> {
    const questions = new Map(
      attempt.questions.map((question) => [
        question.sourceQuestionId,
        question,
      ]),
    );
    await tx.theoryTestAttemptAnswer.deleteMany({
      where: { attemptId: attempt.id },
    });
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
              return { questionId: question.id, optionId: snapshotOptionId };
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

  private async lockOwnAttempt(
    tx: Prisma.TransactionClient,
    actor: User,
    testId: string,
    attemptId: string,
  ): Promise<AttemptRow> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM theory_test_attempts
      WHERE id = ${attemptId}::uuid
        AND test_id = ${testId}::uuid
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
    db: Prisma.TransactionClient | PrismaService,
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

  private expireOverdue(
    organizationId: string,
    testId: string,
    now: Date,
    studentId?: string,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.theoryTestAttempt.updateMany({
      where: {
        organizationId,
        testId,
        ...(studentId ? { studentId } : {}),
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
    db: Prisma.TransactionClient | PrismaService,
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
    db: Prisma.TransactionClient | PrismaService,
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
    db: Prisma.TransactionClient | PrismaService,
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
