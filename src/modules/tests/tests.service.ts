import {
  BadRequestException,
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
  TheoryTestFormat,
  TheoryTestPublicationStatus,
  User,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  assertInsertPosition,
  assertMovePosition,
  shiftForInsert,
  shiftForMove,
} from '../courses/course-structure.order';
import {
  COURSE_NOT_FOUND_MESSAGE,
  COURSE_NOT_PUBLISHED_MESSAGE,
} from '../courses/courses.service';
import {
  AnswerOptionDto,
  CreateAnswerOptionDto,
  CreateQuestionDto,
  CreateTestDto,
  QuestionDto,
  StudentAnswerOptionDto,
  StudentQuestionDto,
  StudentTestDetailDto,
  StudentTestListDto,
  TestDetailDto,
  TestDto,
  TestListDto,
  UpdateAnswerOptionDto,
  UpdateQuestionDto,
  UpdateTestDto,
  UpdateTestPublicationDto,
} from './tests.dto';
import {
  assertFieldErrors,
  exclusiveCorrectErrors,
  isExclusiveFormat,
  publicationErrors,
  questionRuleErrors,
} from './tests.rules';

export const TEST_MANAGE_ROLES = [UserRole.ADMIN] as const;
export const TEST_STUDENT_ROLES = [UserRole.STUDENT] as const;

export const TEST_NOT_FOUND_MESSAGE = 'Test not found';
export const QUESTION_NOT_FOUND_MESSAGE = 'Question not found';
export const OPTION_NOT_FOUND_MESSAGE = 'Answer option not found';
export const TEST_NAME_TAKEN_MESSAGE =
  'Тест з такою назвою вже є в цій автошколі.';
export const NO_TEST_FIELDS_MESSAGE =
  'Немає дозволених полів для оновлення (name, description, courseId, format, passingScore, timeLimitMinutes, maxAttempts, shuffleQuestions).';
export const NO_QUESTION_FIELDS_MESSAGE =
  'Немає дозволених полів для оновлення (text, position).';
export const NO_OPTION_FIELDS_MESSAGE =
  'Немає дозволених полів для оновлення (text, isCorrect, position).';
export const TEST_ARCHIVED_COURSE_MESSAGE =
  'Архівований курс не можна використати для опублікованого тесту.';
export const PUBLISHED_LAST_QUESTION_MESSAGE =
  'Опублікований тест має містити хоча б одне питання.';
export const TEST_NOT_PUBLISHED_MESSAGE = 'Test is not published';

const optionSelect = {
  id: true,
  questionId: true,
  text: true,
  isCorrect: true,
  position: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TheoryAnswerOptionSelect;

const questionSelect = {
  id: true,
  testId: true,
  text: true,
  position: true,
  createdAt: true,
  updatedAt: true,
  options: {
    orderBy: { position: 'asc' as const },
    select: optionSelect,
  },
} satisfies Prisma.TheoryQuestionSelect;

const testSelect = {
  id: true,
  courseId: true,
  name: true,
  description: true,
  format: true,
  passingScore: true,
  timeLimitMinutes: true,
  maxAttempts: true,
  shuffleQuestions: true,
  publicationStatus: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TheoryTestSelect;

const listSelect = {
  ...testSelect,
  _count: { select: { questions: true } },
} satisfies Prisma.TheoryTestSelect;

const detailSelect = {
  ...testSelect,
  questions: {
    orderBy: { position: 'asc' as const },
    select: questionSelect,
  },
} satisfies Prisma.TheoryTestSelect;

type OptionRow = Prisma.TheoryAnswerOptionGetPayload<{
  select: typeof optionSelect;
}>;
type QuestionRow = Prisma.TheoryQuestionGetPayload<{
  select: typeof questionSelect;
}>;
type TestRow = Prisma.TheoryTestGetPayload<{ select: typeof testSelect }>;
type TestDetailRow = Prisma.TheoryTestGetPayload<{
  select: typeof detailSelect;
}>;

function assertCanManage(actor: User): void {
  if (!(TEST_MANAGE_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function assertStudent(actor: User): void {
  if (!(TEST_STUDENT_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function fieldError(field: string, message: string): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    errors: [{ field, message }],
  });
}

function byPosition<T extends { position: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.position - right.position);
}

function toOption(option: OptionRow): AnswerOptionDto {
  return {
    id: option.id,
    questionId: option.questionId,
    text: option.text,
    isCorrect: option.isCorrect,
    position: option.position,
    createdAt: option.createdAt,
    updatedAt: option.updatedAt,
  };
}

function toQuestion(question: QuestionRow): QuestionDto {
  return {
    id: question.id,
    testId: question.testId,
    text: question.text,
    position: question.position,
    createdAt: question.createdAt,
    updatedAt: question.updatedAt,
    options: byPosition(question.options).map(toOption),
  };
}

function toTest(test: TestRow): TestDto {
  return {
    id: test.id,
    courseId: test.courseId,
    name: test.name,
    description: test.description,
    format: test.format,
    passingScore: test.passingScore,
    timeLimitMinutes: test.timeLimitMinutes,
    maxAttempts: test.maxAttempts,
    shuffleQuestions: test.shuffleQuestions,
    publicationStatus: test.publicationStatus,
    createdAt: test.createdAt,
    updatedAt: test.updatedAt,
  };
}

function toDetail(test: TestDetailRow): TestDetailDto {
  return {
    ...toTest(test),
    questions: byPosition(test.questions).map(toQuestion),
  };
}

function toStudentOption(option: OptionRow): StudentAnswerOptionDto {
  return {
    id: option.id,
    questionId: option.questionId,
    text: option.text,
    position: option.position,
    createdAt: option.createdAt,
    updatedAt: option.updatedAt,
  };
}

function toStudentQuestion(question: QuestionRow): StudentQuestionDto {
  return {
    id: question.id,
    testId: question.testId,
    text: question.text,
    position: question.position,
    createdAt: question.createdAt,
    updatedAt: question.updatedAt,
    options: byPosition(question.options).map(toStudentOption),
  };
}

/** Студентський перегляд не містить isCorrect: відповіді відкриваються лише після спроби. */
function toStudentDetail(test: TestDetailRow): StudentTestDetailDto {
  return {
    ...toTest(test),
    questions: byPosition(test.questions).map(toStudentQuestion),
  };
}

async function compactAfterDelete(
  rows: Array<{ id: string; position: number }>,
  removedPosition: number,
  update: (id: string, position: number) => Promise<void>,
): Promise<void> {
  const after = rows
    .filter((row) => row.position > removedPosition)
    .sort((left, right) => left.position - right.position);
  for (const row of after) {
    await update(row.id, row.position - 1);
  }
}

async function lockTest(
  tx: Prisma.TransactionClient,
  testId: string,
  organizationId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM theory_tests
    WHERE id = ${testId}::uuid AND organization_id = ${organizationId}::uuid
    FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new NotFoundException(TEST_NOT_FOUND_MESSAGE);
  }
}

@Injectable()
export class TestsService {
  private readonly logger = new Logger(TestsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(actor: User): Promise<TestListDto> {
    assertCanManage(actor);
    await this.requireOrganization(actor.organizationId);
    const tests = await this.prisma.theoryTest.findMany({
      where: { organizationId: actor.organizationId },
      select: listSelect,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return {
      tests: tests.map((test) => ({
        ...toTest(test),
        questionCount: test._count.questions,
      })),
    };
  }

  async get(actor: User, testId: string): Promise<TestDetailDto> {
    assertCanManage(actor);
    await this.requireOrganization(actor.organizationId);
    const test = await this.prisma.theoryTest.findFirst({
      where: { id: testId, organizationId: actor.organizationId },
      select: detailSelect,
    });
    if (!test) {
      throw new NotFoundException(TEST_NOT_FOUND_MESSAGE);
    }
    return toDetail(test);
  }

  async create(actor: User, payload: CreateTestDto): Promise<TestDto> {
    assertCanManage(actor);
    await this.requireOrganization(actor.organizationId);

    const created = await this.prisma.$transaction(async (tx) => {
      await this.requireCourse(tx, actor, payload.courseId);
      await this.assertNameAvailable(tx, actor.organizationId, payload.name);
      return tx.theoryTest.create({
        data: {
          organizationId: actor.organizationId,
          courseId: payload.courseId,
          name: payload.name,
          description: payload.description ?? null,
          format: payload.format,
          passingScore: payload.passingScore,
          timeLimitMinutes: payload.timeLimitMinutes ?? null,
          maxAttempts: payload.maxAttempts ?? null,
          shuffleQuestions: payload.shuffleQuestions ?? false,
          publicationStatus: TheoryTestPublicationStatus.DRAFT,
        },
        select: testSelect,
      });
    });

    this.logger.log(
      `Test created testId=${created.id} courseId=${created.courseId} organizationId=${actor.organizationId} actorId=${actor.id}`,
    );
    return toTest(created);
  }

  async update(
    actor: User,
    testId: string,
    payload: UpdateTestDto,
  ): Promise<TestDto> {
    assertCanManage(actor);
    await this.requireOrganization(actor.organizationId);
    if (!hasTestChanges(payload)) {
      throw fieldError('body', NO_TEST_FIELDS_MESSAGE);
    }

    const updated = await this.withLockedTest(actor, testId, async (tx) => {
      const existing = await this.requireTest(tx, actor, testId);
      const data: Prisma.TheoryTestUncheckedUpdateInput = {};

      if (payload.name !== undefined && payload.name !== existing.name) {
        await this.assertNameAvailable(
          tx,
          actor.organizationId,
          payload.name,
          existing.id,
        );
        data.name = payload.name;
      }
      if (
        payload.description !== undefined &&
        payload.description !== existing.description
      ) {
        data.description = payload.description;
      }
      if (
        payload.courseId !== undefined &&
        payload.courseId !== existing.courseId
      ) {
        const course = await this.requireCourse(tx, actor, payload.courseId);
        if (
          existing.publicationStatus ===
            TheoryTestPublicationStatus.PUBLISHED &&
          course.status !== CourseStatus.ACTIVE
        ) {
          throw new ConflictException(TEST_ARCHIVED_COURSE_MESSAGE);
        }
        data.courseId = course.id;
      }
      if (payload.format !== undefined && payload.format !== existing.format) {
        await this.assertFormatChange(tx, existing, payload.format);
        data.format = payload.format;
      }
      if (
        payload.passingScore !== undefined &&
        payload.passingScore !== existing.passingScore
      ) {
        data.passingScore = payload.passingScore;
      }
      if (
        payload.timeLimitMinutes !== undefined &&
        payload.timeLimitMinutes !== existing.timeLimitMinutes
      ) {
        data.timeLimitMinutes = payload.timeLimitMinutes;
      }
      if (
        payload.maxAttempts !== undefined &&
        payload.maxAttempts !== existing.maxAttempts
      ) {
        data.maxAttempts = payload.maxAttempts;
      }
      if (
        payload.shuffleQuestions !== undefined &&
        payload.shuffleQuestions !== existing.shuffleQuestions
      ) {
        data.shuffleQuestions = payload.shuffleQuestions;
      }
      if (Object.keys(data).length === 0) {
        return existing;
      }
      return tx.theoryTest.update({
        where: { id: existing.id },
        data,
        select: testSelect,
      });
    });

    this.logger.log(
      `Test updated testId=${updated.id} organizationId=${actor.organizationId} actorId=${actor.id}`,
    );
    return toTest(updated);
  }

  async changePublication(
    actor: User,
    testId: string,
    payload: UpdateTestPublicationDto,
  ): Promise<TestDto> {
    assertCanManage(actor);
    await this.requireOrganization(actor.organizationId);

    let changed = false;
    const saved = await this.withLockedTest(actor, testId, async (tx) => {
      const existing = await this.requireTest(tx, actor, testId);
      if (payload.publicationStatus === existing.publicationStatus) {
        return existing;
      }
      if (payload.publicationStatus === TheoryTestPublicationStatus.PUBLISHED) {
        await this.assertCanPublish(tx, actor, existing);
        changed = true;
      } else {
        changed = true;
      }
      return tx.theoryTest.update({
        where: { id: existing.id },
        data: { publicationStatus: payload.publicationStatus },
        select: testSelect,
      });
    });

    if (changed) {
      this.logger.log(
        `Test publication changed testId=${saved.id} publicationStatus=${saved.publicationStatus} organizationId=${actor.organizationId} actorId=${actor.id}`,
      );
    }
    return toTest(saved);
  }

  /**
   * Опубліковані тести курсу поточної групи студента.
   * Чернетки не входять у відповідь. Неопублікований або архівований курс — 403.
   */
  async listCurrent(actor: User): Promise<StudentTestListDto> {
    assertStudent(actor);
    await this.requireOrganization(actor.organizationId);
    const courseId = await this.requireCurrentCourseId(actor);
    await this.requireAssignedPublishedCourse(actor, courseId);

    const tests = await this.prisma.theoryTest.findMany({
      where: {
        organizationId: actor.organizationId,
        courseId,
        publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
      },
      select: listSelect,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return {
      courseId,
      tests: tests.map((test) => ({
        ...toTest(test),
        questionCount: test._count.questions,
      })),
    };
  }

  /**
   * Один опублікований тест для проходження.
   * isCorrect у відповіді немає: студент не бачить правильні відповіді до завершення спроби.
   */
  async getContent(actor: User, testId: string): Promise<StudentTestDetailDto> {
    assertStudent(actor);
    await this.requireOrganization(actor.organizationId);

    const test = await this.prisma.theoryTest.findFirst({
      where: { id: testId, organizationId: actor.organizationId },
      select: detailSelect,
    });
    if (!test) {
      throw new NotFoundException(TEST_NOT_FOUND_MESSAGE);
    }
    await this.requireAssignedPublishedCourse(actor, test.courseId);
    if (test.publicationStatus !== TheoryTestPublicationStatus.PUBLISHED) {
      throw new ForbiddenException(TEST_NOT_PUBLISHED_MESSAGE);
    }
    return toStudentDetail(test);
  }

  async createQuestion(
    actor: User,
    testId: string,
    payload: CreateQuestionDto,
  ): Promise<QuestionDto> {
    assertCanManage(actor);
    await this.requireOrganization(actor.organizationId);

    const created = await this.withLockedTest(actor, testId, async (tx) => {
      const test = await this.requireTest(tx, actor, testId);
      const options = payload.options ?? [];
      if (test.publicationStatus === TheoryTestPublicationStatus.PUBLISHED) {
        assertFieldErrors(questionRuleErrors(test.format, options));
      } else if (options.length > 0) {
        assertFieldErrors(exclusiveCorrectErrors(test.format, options));
      }

      const siblings = await tx.theoryQuestion.findMany({
        where: { testId },
        select: { id: true, position: true },
        orderBy: { position: 'asc' },
      });
      const position = assertInsertPosition(siblings.length, payload.position);
      await shiftForInsert(siblings, position, this.questionPosition(tx));
      return tx.theoryQuestion.create({
        data: {
          testId,
          organizationId: actor.organizationId,
          text: payload.text,
          position,
          ...(options.length > 0
            ? {
                options: {
                  create: options.map((option, index) => ({
                    testId,
                    text: option.text,
                    isCorrect: option.isCorrect,
                    position: index + 1,
                  })),
                },
              }
            : {}),
        },
        select: questionSelect,
      });
    });

    this.logger.log(
      `Question created questionId=${created.id} testId=${testId} organizationId=${actor.organizationId} actorId=${actor.id}`,
    );
    return toQuestion(created);
  }

  async updateQuestion(
    actor: User,
    testId: string,
    questionId: string,
    payload: UpdateQuestionDto,
  ): Promise<QuestionDto> {
    assertCanManage(actor);
    await this.requireOrganization(actor.organizationId);
    if (payload.text === undefined && payload.position === undefined) {
      throw fieldError('body', NO_QUESTION_FIELDS_MESSAGE);
    }

    const updated = await this.withLockedTest(actor, testId, async (tx) => {
      await this.requireTest(tx, actor, testId);
      const existing = await this.requireQuestion(
        tx,
        actor,
        testId,
        questionId,
      );
      const data: Prisma.TheoryQuestionUpdateInput = {};
      if (payload.text !== undefined && payload.text !== existing.text) {
        data.text = payload.text;
      }
      if (
        payload.position !== undefined &&
        payload.position !== existing.position
      ) {
        const siblings = await tx.theoryQuestion.findMany({
          where: { testId },
          select: { id: true, position: true },
          orderBy: { position: 'asc' },
        });
        const position = assertMovePosition(siblings.length, payload.position);
        await shiftForMove(
          siblings,
          existing.id,
          existing.position,
          position,
          this.questionPosition(tx),
        );
        data.position = position;
      }
      if (Object.keys(data).length === 0) {
        return existing;
      }
      return tx.theoryQuestion.update({
        where: { id: existing.id },
        data,
        select: questionSelect,
      });
    });

    this.logger.log(
      `Question updated questionId=${updated.id} testId=${testId} organizationId=${actor.organizationId} actorId=${actor.id}`,
    );
    return toQuestion(updated);
  }

  async deleteQuestion(
    actor: User,
    testId: string,
    questionId: string,
  ): Promise<QuestionDto> {
    assertCanManage(actor);
    await this.requireOrganization(actor.organizationId);

    const removed = await this.withLockedTest(actor, testId, async (tx) => {
      const test = await this.requireTest(tx, actor, testId);
      const existing = await this.requireQuestion(
        tx,
        actor,
        testId,
        questionId,
      );
      const siblings = await tx.theoryQuestion.findMany({
        where: { testId },
        select: { id: true, position: true },
        orderBy: { position: 'asc' },
      });
      if (
        test.publicationStatus === TheoryTestPublicationStatus.PUBLISHED &&
        siblings.length <= 1
      ) {
        throw fieldError('questions', PUBLISHED_LAST_QUESTION_MESSAGE);
      }
      await tx.theoryQuestion.delete({ where: { id: existing.id } });
      await compactAfterDelete(
        siblings,
        existing.position,
        this.questionPosition(tx),
      );
      return existing;
    });

    this.logger.log(
      `Question deleted questionId=${removed.id} testId=${testId} organizationId=${actor.organizationId} actorId=${actor.id}`,
    );
    return toQuestion(removed);
  }

  async createOption(
    actor: User,
    testId: string,
    questionId: string,
    payload: CreateAnswerOptionDto,
  ): Promise<AnswerOptionDto> {
    assertCanManage(actor);
    await this.requireOrganization(actor.organizationId);

    const created = await this.withLockedTest(actor, testId, async (tx) => {
      const test = await this.requireTest(tx, actor, testId);
      const question = await this.requireQuestion(
        tx,
        actor,
        testId,
        questionId,
      );
      const projected = projectAdded(
        test.format,
        question.options,
        payload.isCorrect,
      );
      if (test.publicationStatus === TheoryTestPublicationStatus.PUBLISHED) {
        assertFieldErrors(questionRuleErrors(test.format, projected));
      }

      const position = assertInsertPosition(
        question.options.length,
        payload.position,
      );
      await shiftForInsert(question.options, position, this.optionPosition(tx));
      if (payload.isCorrect && isExclusiveFormat(test.format)) {
        await tx.theoryAnswerOption.updateMany({
          where: { questionId },
          data: { isCorrect: false },
        });
      }
      return tx.theoryAnswerOption.create({
        data: {
          questionId,
          testId,
          text: payload.text,
          isCorrect: payload.isCorrect,
          position,
        },
        select: optionSelect,
      });
    });

    this.logger.log(
      `Answer option created optionId=${created.id} questionId=${questionId} testId=${testId} organizationId=${actor.organizationId} actorId=${actor.id}`,
    );
    return toOption(created);
  }

  async updateOption(
    actor: User,
    testId: string,
    questionId: string,
    optionId: string,
    payload: UpdateAnswerOptionDto,
  ): Promise<AnswerOptionDto> {
    assertCanManage(actor);
    await this.requireOrganization(actor.organizationId);
    if (
      payload.text === undefined &&
      payload.isCorrect === undefined &&
      payload.position === undefined
    ) {
      throw fieldError('body', NO_OPTION_FIELDS_MESSAGE);
    }

    const updated = await this.withLockedTest(actor, testId, async (tx) => {
      const test = await this.requireTest(tx, actor, testId);
      const question = await this.requireQuestion(
        tx,
        actor,
        testId,
        questionId,
      );
      const existing = question.options.find(
        (option) => option.id === optionId,
      );
      if (!existing) {
        throw new NotFoundException(OPTION_NOT_FOUND_MESSAGE);
      }

      const nextCorrect = payload.isCorrect ?? existing.isCorrect;
      if (test.publicationStatus === TheoryTestPublicationStatus.PUBLISHED) {
        assertFieldErrors(
          questionRuleErrors(
            test.format,
            projectUpdated(
              test.format,
              question.options,
              optionId,
              nextCorrect,
            ),
          ),
        );
      }

      const data: Prisma.TheoryAnswerOptionUpdateInput = {};
      if (payload.text !== undefined && payload.text !== existing.text) {
        data.text = payload.text;
      }
      if (payload.isCorrect === true && isExclusiveFormat(test.format)) {
        await tx.theoryAnswerOption.updateMany({
          where: { questionId, NOT: { id: optionId } },
          data: { isCorrect: false },
        });
        data.isCorrect = true;
      } else if (
        payload.isCorrect !== undefined &&
        payload.isCorrect !== existing.isCorrect
      ) {
        data.isCorrect = payload.isCorrect;
      }
      if (
        payload.position !== undefined &&
        payload.position !== existing.position
      ) {
        const position = assertMovePosition(
          question.options.length,
          payload.position,
        );
        await shiftForMove(
          question.options,
          existing.id,
          existing.position,
          position,
          this.optionPosition(tx),
        );
        data.position = position;
      }
      if (Object.keys(data).length === 0) {
        return existing;
      }
      return tx.theoryAnswerOption.update({
        where: { id: existing.id },
        data,
        select: optionSelect,
      });
    });

    this.logger.log(
      `Answer option updated optionId=${updated.id} questionId=${questionId} testId=${testId} organizationId=${actor.organizationId} actorId=${actor.id}`,
    );
    return toOption(updated);
  }

  async deleteOption(
    actor: User,
    testId: string,
    questionId: string,
    optionId: string,
  ): Promise<AnswerOptionDto> {
    assertCanManage(actor);
    await this.requireOrganization(actor.organizationId);

    const removed = await this.withLockedTest(actor, testId, async (tx) => {
      const test = await this.requireTest(tx, actor, testId);
      const question = await this.requireQuestion(
        tx,
        actor,
        testId,
        questionId,
      );
      const existing = question.options.find(
        (option) => option.id === optionId,
      );
      if (!existing) {
        throw new NotFoundException(OPTION_NOT_FOUND_MESSAGE);
      }
      if (test.publicationStatus === TheoryTestPublicationStatus.PUBLISHED) {
        assertFieldErrors(
          questionRuleErrors(
            test.format,
            question.options.filter((option) => option.id !== optionId),
          ),
        );
      }
      await tx.theoryAnswerOption.delete({ where: { id: existing.id } });
      await compactAfterDelete(
        question.options,
        existing.position,
        this.optionPosition(tx),
      );
      return existing;
    });

    this.logger.log(
      `Answer option deleted optionId=${removed.id} questionId=${questionId} testId=${testId} organizationId=${actor.organizationId} actorId=${actor.id}`,
    );
    return toOption(removed);
  }

  private async assertCanPublish(
    tx: Prisma.TransactionClient,
    actor: User,
    test: TestRow,
  ): Promise<void> {
    const course = await tx.course.findFirst({
      where: { id: test.courseId, organizationId: actor.organizationId },
      select: { status: true },
    });
    if (!course) {
      throw new NotFoundException(COURSE_NOT_FOUND_MESSAGE);
    }
    if (course.status !== CourseStatus.ACTIVE) {
      throw new ConflictException(TEST_ARCHIVED_COURSE_MESSAGE);
    }
    const questions = await tx.theoryQuestion.findMany({
      where: { testId: test.id },
      select: { options: { select: { isCorrect: true } } },
    });
    assertFieldErrors(publicationErrors(test.format, questions));
  }

  private async assertFormatChange(
    tx: Prisma.TransactionClient,
    test: TestRow,
    format: TheoryTestFormat,
  ): Promise<void> {
    const questions = await tx.theoryQuestion.findMany({
      where: { testId: test.id },
      select: { options: { select: { isCorrect: true } } },
    });
    if (test.publicationStatus === TheoryTestPublicationStatus.PUBLISHED) {
      assertFieldErrors(publicationErrors(format, questions));
      return;
    }
    questions.forEach((question, index) => {
      assertFieldErrors(
        exclusiveCorrectErrors(
          format,
          question.options,
          `questions[${index}].options`,
        ),
      );
    });
  }

  private withLockedTest<T>(
    actor: User,
    testId: string,
    run: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await lockTest(tx, testId, actor.organizationId);
      return run(tx);
    });
  }

  private async requireTest(
    tx: Prisma.TransactionClient,
    actor: User,
    testId: string,
  ): Promise<TestRow> {
    const test = await tx.theoryTest.findFirst({
      where: { id: testId, organizationId: actor.organizationId },
      select: testSelect,
    });
    if (!test) {
      throw new NotFoundException(TEST_NOT_FOUND_MESSAGE);
    }
    return test;
  }

  private async requireQuestion(
    tx: Prisma.TransactionClient,
    actor: User,
    testId: string,
    questionId: string,
  ): Promise<QuestionRow> {
    const question = await tx.theoryQuestion.findFirst({
      where: {
        id: questionId,
        testId,
        organizationId: actor.organizationId,
      },
      select: questionSelect,
    });
    if (!question) {
      throw new NotFoundException(QUESTION_NOT_FOUND_MESSAGE);
    }
    return question;
  }

  private async requireCourse(
    tx: Prisma.TransactionClient,
    actor: User,
    courseId: string,
  ): Promise<{ id: string; status: CourseStatus }> {
    const course = await tx.course.findFirst({
      where: { id: courseId, organizationId: actor.organizationId },
      select: { id: true, status: true },
    });
    if (!course) {
      throw new NotFoundException(COURSE_NOT_FOUND_MESSAGE);
    }
    return course;
  }

  private async assertNameAvailable(
    tx: Prisma.TransactionClient,
    organizationId: string,
    name: string,
    excludeTestId?: string,
  ): Promise<void> {
    const duplicate = await tx.theoryTest.findFirst({
      where: {
        organizationId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeTestId ? { NOT: { id: excludeTestId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException({
        statusCode: 409,
        errors: [{ field: 'name', message: TEST_NAME_TAKEN_MESSAGE }],
      });
    }
  }

  private questionPosition(tx: Prisma.TransactionClient) {
    return (id: string, position: number) =>
      tx.theoryQuestion
        .update({ where: { id }, data: { position } })
        .then(() => undefined);
  }

  private optionPosition(tx: Prisma.TransactionClient) {
    return (id: string, position: number) =>
      tx.theoryAnswerOption
        .update({ where: { id }, data: { position } })
        .then(() => undefined);
  }

  private async requireCurrentCourseId(actor: User): Promise<string> {
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
    return courseId;
  }

  /**
   * Тест доступний студенту лише разом із курсом: активне зарахування в групу
   * цієї автошколи, курс ACTIVE і PUBLISHED. Чужий курс — 403, чужа автошкола — 404.
   */
  private async requireAssignedPublishedCourse(
    actor: User,
    courseId: string,
  ): Promise<void> {
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, organizationId: actor.organizationId },
      select: { id: true, status: true, publicationStatus: true },
    });
    if (!course) {
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

function hasTestChanges(payload: UpdateTestDto): boolean {
  return (
    payload.name !== undefined ||
    payload.description !== undefined ||
    payload.courseId !== undefined ||
    payload.format !== undefined ||
    payload.passingScore !== undefined ||
    payload.timeLimitMinutes !== undefined ||
    payload.maxAttempts !== undefined ||
    payload.shuffleQuestions !== undefined
  );
}

function projectAdded(
  format: TheoryTestFormat,
  options: OptionRow[],
  isCorrect: boolean,
): Array<{ isCorrect: boolean }> {
  const kept =
    isCorrect && isExclusiveFormat(format)
      ? options.map(() => ({ isCorrect: false }))
      : options.map((option) => ({ isCorrect: option.isCorrect }));
  return [...kept, { isCorrect }];
}

function projectUpdated(
  format: TheoryTestFormat,
  options: OptionRow[],
  optionId: string,
  isCorrect: boolean,
): Array<{ isCorrect: boolean }> {
  return options.map((option) => {
    if (option.id === optionId) {
      return { isCorrect };
    }
    if (isCorrect && isExclusiveFormat(format)) {
      return { isCorrect: false };
    }
    return { isCorrect: option.isCorrect };
  });
}
