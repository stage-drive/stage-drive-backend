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
  SubmitAttemptDto,
} from './test-attempts.dto';
import {
  attemptDeadline,
  gradeAttempt,
  isAttemptExpired,
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

const catalogSelect = {
  id: true,
  courseId: true,
  format: true,
  passingScore: true,
  timeLimitMinutes: true,
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

function assertStudent(actor: User): void {
  if (!(TEST_STUDENT_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function revealsAnswers(status: TheoryTestAttemptStatus): boolean {
  return (
    status === TheoryTestAttemptStatus.PASSED ||
    status === TheoryTestAttemptStatus.FAILED
  );
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
        throw new ConflictException({
          statusCode: 409,
          message: ATTEMPT_IN_PROGRESS_MESSAGE,
          attemptId: open.id,
        });
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
          status: passed ? TheoryTestStatus.PASSED : TheoryTestStatus.FAILED,
          score,
          takenAt: now,
        },
        update: {
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
