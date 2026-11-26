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
  CourseLessonPublicationStatus,
  CourseStatus,
  EnrollmentStatus,
  Prisma,
  TheoryTestAttemptStatus,
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
import { LESSON_NOT_FOUND_MESSAGE } from '../courses/course-structure.service';
import {
  LESSON_LOCKED_MESSAGE,
  LESSON_RETRY_MESSAGE,
  LESSON_TEST_ATTEMPTS,
  loadLessonGate,
  type LessonTestState,
} from '../courses/lesson-gate';
import {
  COURSE_NOT_FOUND_MESSAGE,
  COURSE_NOT_PUBLISHED_MESSAGE,
} from '../courses/courses.service';
import {
  AnswerOptionDto,
  CreateAnswerOptionDto,
  CreateLessonTestDto,
  CreateQuestionDto,
  CreateTestDto,
  LessonTestDto,
  LessonTestQuestionDto,
  QuestionDto,
  StudentAnswerOptionDto,
  StudentQuestionDto,
  StudentTestDetailDto,
  StudentTestListDto,
  TestDetailDto,
  TestDto,
  TestListDto,
  TestListQueryDto,
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
  testPublicationErrors,
} from './tests.rules';

export const TEST_MANAGE_ROLES = [UserRole.ADMIN, UserRole.TEACHER] as const;
export const TEST_STUDENT_ROLES = [UserRole.STUDENT] as const;

export const TEST_NOT_FOUND_MESSAGE = 'Test not found';
export const QUESTION_NOT_FOUND_MESSAGE = 'Question not found';
export const OPTION_NOT_FOUND_MESSAGE = 'Answer option not found';
export const TEST_NAME_TAKEN_MESSAGE =
  'Тест з такою назвою вже є в цій автошколі.';
export const NO_TEST_FIELDS_MESSAGE =
  'Немає дозволених полів для оновлення (name, description, lessonId, courseId, format, passingScore, timeLimitMinutes, maxAttempts, shuffleQuestions).';
export const NO_QUESTION_FIELDS_MESSAGE =
  'Немає дозволених полів для оновлення (text, type, position).';
export const NO_OPTION_FIELDS_MESSAGE =
  'Немає дозволених полів для оновлення (text, isCorrect, position).';
export const TEST_ARCHIVED_COURSE_MESSAGE =
  'Архівований курс не можна використати для опублікованого тесту.';
export const PUBLISHED_LAST_QUESTION_MESSAGE =
  'Опублікований тест має містити хоча б одне питання.';
export const TEST_NOT_PUBLISHED_MESSAGE = 'Test is not published';
export const LESSON_TEST_EXISTS_MESSAGE = 'У цього уроку вже є тест.';
export const LESSON_TEST_ATTEMPTS_MESSAGE = 'Тест уроку має рівно 3 спроби.';
export const LESSON_TEST_COURSE_MESSAGE =
  'Тест уроку лишається на своєму курсі.';
export const TEST_ARCHIVED_MESSAGE = 'Архівований тест не можна змінювати.';
export const PUBLISHED_LESSON_KEEPS_TEST_MESSAGE =
  'Урок уже опубліковано. Спершу зніміть урок з публікації, а потім тест.';
export const TEST_LESSON_DRAFT_ONLY_MESSAGE =
  'Урок тесту можна змінити лише поки тест у чернетці.';
export const LESSON_REQUIRED_MESSAGE =
  'Вкажіть lessonId: тест належить уроку курсу.';
export const LESSON_COURSE_MISMATCH_MESSAGE =
  'Урок належить іншому курсу, ніж указано в courseId.';
export const LESSON_TEST_NOT_FOUND_MESSAGE =
  'У цього уроку немає опублікованого тесту.';

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
  type: true,
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
  courseLessonId: true,
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

/** Архівний тест лише читається: його історія спроб не має змінюватися задним числом. */
function assertNotArchived(test: {
  publicationStatus: TheoryTestPublicationStatus;
}): void {
  if (test.publicationStatus === TheoryTestPublicationStatus.ARCHIVED) {
    throw new ConflictException(TEST_ARCHIVED_MESSAGE);
  }
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
    type: question.type,
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
    lessonId: test.courseLessonId ?? null,
    courseLessonId: test.courseLessonId ?? null,
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
    type: question.type,
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

/** Зміст тесту уроку без isCorrect плюс лічильники поточного циклу з гейта уроків. */
function toLessonTest(
  test: TestDetailRow,
  state: LessonTestState,
): LessonTestDto {
  return {
    id: test.id,
    lessonId: test.courseLessonId ?? '',
    courseId: test.courseId,
    name: test.name,
    description: test.description,
    status: test.publicationStatus,
    passingScore: test.passingScore,
    timeLimitMinutes: test.timeLimitMinutes,
    maxAttempts: test.maxAttempts,
    shuffleQuestions: test.shuffleQuestions,
    questionCount: test.questions.length,
    questions: byPosition(test.questions).map(toLessonTestQuestion),
    passed: state.passed,
    attemptsUsed: state.attemptsUsed,
    attemptsLeft: state.attemptsLeft,
    openAttemptId: state.openAttemptId,
    nextAttemptAvailable: state.nextAttemptAvailable,
    unavailableReason: state.unavailableReason,
    lockedNextUntilPassed: !state.passed,
    ...(state.exhausted ? { message: LESSON_RETRY_MESSAGE } : {}),
  };
}

function toLessonTestQuestion(question: QuestionRow): LessonTestQuestionDto {
  return {
    id: question.id,
    type: question.type,
    text: question.text,
    position: question.position,
    options: byPosition(question.options).map((option) => ({
      id: option.id,
      text: option.text,
      position: option.position,
    })),
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

  /**
   * Тести своєї автошколи. TEACHER бачить тести курсів своїх груп.
   * courseId, lessonId і publicationStatus звужують список; для викладача курс
   * (або курс уроку) має бути призначений його групі.
   */
  async list(
    actor: User,
    filters: TestListQueryDto = {},
  ): Promise<TestListDto> {
    assertCanManage(actor);
    await this.requireOrganization(actor.organizationId);
    let courseId = filters.courseId;
    if (filters.lessonId) {
      const lesson = await this.prisma.courseLesson.findFirst({
        where: {
          id: filters.lessonId,
          course: { organizationId: actor.organizationId },
        },
        select: { id: true, courseId: true },
      });
      if (!lesson) {
        throw new NotFoundException(LESSON_NOT_FOUND_MESSAGE);
      }
      if (courseId && courseId !== lesson.courseId) {
        return { tests: [] };
      }
      courseId = lesson.courseId;
    }
    if (courseId) {
      await this.requireCourse(this.prisma, actor, courseId);
    }
    const tests = await this.prisma.theoryTest.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(filters.lessonId ? { courseLessonId: filters.lessonId } : {}),
        ...(filters.publicationStatus
          ? { publicationStatus: filters.publicationStatus }
          : {}),
        ...(courseId
          ? { courseId }
          : actor.role === UserRole.TEACHER
            ? {
                course: {
                  groups: {
                    some: {
                      teacherId: actor.id,
                      organizationId: actor.organizationId,
                    },
                  },
                },
              }
            : {}),
      },
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
    await this.assertTeacherCourse(this.prisma, actor, test.courseId);
    return toDetail(test);
  }

  /**
   * Новий тест завжди DRAFT. Тест належить уроку програми курсу (lessonId): курс береться з уроку,
   * maxAttempts завжди 3, а в уроку може бути лише один не архівний тест.
   * Без lessonId (старий формат, лише courseId) створюється тест курсу без уроку:
   * його не можна опублікувати, доки PATCH /tests/{testId} не вкаже lessonId.
   */
  async create(actor: User, payload: CreateTestDto): Promise<TestDto> {
    assertCanManage(actor);
    await this.requireOrganization(actor.organizationId);

    const created = await this.prisma.$transaction(async (tx) => {
      let courseId = payload.courseId;
      if (payload.lessonId) {
        const lesson = await tx.courseLesson.findFirst({
          where: {
            id: payload.lessonId,
            course: { organizationId: actor.organizationId },
          },
          select: { id: true, courseId: true },
        });
        if (!lesson) {
          throw new NotFoundException(LESSON_NOT_FOUND_MESSAGE);
        }
        if (courseId && courseId !== lesson.courseId) {
          throw fieldError('courseId', LESSON_COURSE_MISMATCH_MESSAGE);
        }
        courseId = lesson.courseId;
      }
      if (!courseId) {
        throw fieldError('lessonId', LESSON_REQUIRED_MESSAGE);
      }
      await this.requireCourse(tx, actor, courseId);
      return this.createTest(tx, actor, {
        courseId,
        lessonId: payload.lessonId ?? null,
        payload,
      });
    });

    this.logger.log(
      `Test created testId=${created.id} lessonId=${created.courseLessonId ?? 'none'} courseId=${created.courseId} organizationId=${actor.organizationId} actorId=${actor.id}`,
    );
    return toTest(created);
  }

  /**
   * Тест одного уроку за адресою курс → розділ → урок. maxAttempts завжди 3. Один актуальний тест на урок.
   * Публікується тим самим PATCH /tests/{testId}/publication.
   */
  async createForLesson(
    actor: User,
    courseId: string,
    chapterId: string,
    lessonId: string,
    payload: CreateLessonTestDto,
  ): Promise<TestDto> {
    assertCanManage(actor);
    await this.requireOrganization(actor.organizationId);

    const created = await this.prisma.$transaction(async (tx) => {
      await this.requireCourse(tx, actor, courseId);
      const lesson = await tx.courseLesson.findFirst({
        where: { id: lessonId, chapterId, courseId },
        select: { id: true },
      });
      if (!lesson) {
        throw new NotFoundException(LESSON_NOT_FOUND_MESSAGE);
      }
      return this.createTest(tx, actor, { courseId, lessonId, payload });
    });

    this.logger.log(
      `Lesson test created testId=${created.id} lessonId=${lessonId} courseId=${courseId} organizationId=${actor.organizationId} actorId=${actor.id}`,
    );
    return toTest(created);
  }

  private async createTest(
    tx: Prisma.TransactionClient,
    actor: User,
    input: {
      courseId: string;
      lessonId: string | null;
      payload: Pick<
        CreateTestDto,
        | 'name'
        | 'description'
        | 'format'
        | 'passingScore'
        | 'timeLimitMinutes'
        | 'shuffleQuestions'
      > & { maxAttempts?: number | null };
    },
  ): Promise<TestRow> {
    const { courseId, lessonId, payload } = input;
    if (lessonId) {
      if (
        payload.maxAttempts !== undefined &&
        payload.maxAttempts !== null &&
        payload.maxAttempts !== LESSON_TEST_ATTEMPTS
      ) {
        throw fieldError('maxAttempts', LESSON_TEST_ATTEMPTS_MESSAGE);
      }
      await this.assertLessonFree(tx, actor.organizationId, lessonId);
    }
    await this.assertNameAvailable(tx, actor.organizationId, payload.name);
    return tx.theoryTest.create({
      data: {
        organizationId: actor.organizationId,
        courseId,
        courseLessonId: lessonId,
        name: payload.name,
        description: payload.description ?? null,
        format: payload.format ?? TheoryTestFormat.SINGLE_CHOICE,
        passingScore: payload.passingScore,
        timeLimitMinutes: payload.timeLimitMinutes ?? null,
        maxAttempts: lessonId
          ? LESSON_TEST_ATTEMPTS
          : (payload.maxAttempts ?? null),
        shuffleQuestions: payload.shuffleQuestions ?? false,
        publicationStatus: TheoryTestPublicationStatus.DRAFT,
      },
      select: testSelect,
    });
  }

  /** У уроку може бути лише один не архівний тест. Архівний звільняє місце новому. */
  private async assertLessonFree(
    tx: Prisma.TransactionClient,
    organizationId: string,
    lessonId: string,
    excludeTestId?: string,
  ): Promise<void> {
    const existing = await tx.theoryTest.findFirst({
      where: {
        organizationId,
        courseLessonId: lessonId,
        publicationStatus: { not: TheoryTestPublicationStatus.ARCHIVED },
        ...(excludeTestId ? { NOT: { id: excludeTestId } } : {}),
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(LESSON_TEST_EXISTS_MESSAGE);
    }
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
      assertNotArchived(existing);
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
        if (existing.courseLessonId) {
          throw new ConflictException(LESSON_TEST_COURSE_MESSAGE);
        }
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
      if (
        payload.lessonId !== undefined &&
        payload.lessonId !== existing.courseLessonId
      ) {
        if (existing.publicationStatus !== TheoryTestPublicationStatus.DRAFT) {
          throw new ConflictException(TEST_LESSON_DRAFT_ONLY_MESSAGE);
        }
        const lesson = await tx.courseLesson.findFirst({
          where: {
            id: payload.lessonId,
            courseId:
              (data.courseId as string | undefined) ?? existing.courseId,
          },
          select: { id: true },
        });
        if (!lesson) {
          throw new NotFoundException(LESSON_NOT_FOUND_MESSAGE);
        }
        await this.assertLessonFree(
          tx,
          actor.organizationId,
          lesson.id,
          existing.id,
        );
        data.courseLessonId = lesson.id;
        data.maxAttempts = LESSON_TEST_ATTEMPTS;
      }
      if (payload.format !== undefined && payload.format !== existing.format) {
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
        const lessonAfter =
          (data.courseLessonId as string | undefined) ??
          existing.courseLessonId;
        if (lessonAfter && payload.maxAttempts !== LESSON_TEST_ATTEMPTS) {
          throw fieldError('maxAttempts', LESSON_TEST_ATTEMPTS_MESSAGE);
        }
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
      assertNotArchived(existing);
      if (payload.publicationStatus === existing.publicationStatus) {
        return existing;
      }
      if (payload.publicationStatus === TheoryTestPublicationStatus.PUBLISHED) {
        await this.assertCanPublish(tx, actor, existing);
        changed = true;
      } else {
        await this.assertPublishedLessonKeepsItsTest(tx, actor, existing);
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
   * Архівує тест: студенти його більше не бачать, а в уроку з’являється місце для нового тесту.
   * Історія спроб лишається. Відкриті спроби архівного тесту закриваються як EXPIRED:
   * продовжити їх уже не можна. Повторний виклик нічого не змінює.
   */
  async archive(actor: User, testId: string): Promise<TestDto> {
    assertCanManage(actor);
    await this.requireOrganization(actor.organizationId);

    let changed = false;
    const saved = await this.withLockedTest(actor, testId, async (tx) => {
      const existing = await this.requireTest(tx, actor, testId);
      if (existing.publicationStatus === TheoryTestPublicationStatus.ARCHIVED) {
        return existing;
      }
      await this.assertPublishedLessonKeepsItsTest(tx, actor, existing);
      changed = true;
      await tx.theoryTestAttempt.updateMany({
        where: {
          testId: existing.id,
          status: TheoryTestAttemptStatus.IN_PROGRESS,
        },
        data: {
          status: TheoryTestAttemptStatus.EXPIRED,
          submittedAt: new Date(),
        },
      });
      return tx.theoryTest.update({
        where: { id: existing.id },
        data: { publicationStatus: TheoryTestPublicationStatus.ARCHIVED },
        select: testSelect,
      });
    });

    if (changed) {
      this.logger.log(
        `Test archived testId=${saved.id} organizationId=${actor.organizationId} actorId=${actor.id}`,
      );
    }
    return toTest(saved);
  }

  /**
   * Опублікований урок не лишається без опублікованого тесту.
   * Чернетку й тест неопублікованого уроку можна зняти або архівувати.
   */
  private async assertPublishedLessonKeepsItsTest(
    tx: Prisma.TransactionClient,
    actor: User,
    test: {
      courseLessonId: string | null;
      publicationStatus: TheoryTestPublicationStatus;
    },
  ): Promise<void> {
    if (
      !test.courseLessonId ||
      test.publicationStatus !== TheoryTestPublicationStatus.PUBLISHED
    ) {
      return;
    }
    const lesson = await tx.courseLesson.findFirst({
      where: {
        id: test.courseLessonId,
        course: { organizationId: actor.organizationId },
      },
      select: { publicationStatus: true },
    });
    if (
      lesson?.publicationStatus === CourseLessonPublicationStatus.PUBLISHED
    ) {
      throw new ConflictException(PUBLISHED_LESSON_KEEPS_TEST_MESSAGE);
    }
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
    if (test.courseLessonId) {
      const gate = await loadLessonGate(
        this.prisma,
        actor.organizationId,
        test.courseId,
        actor.id,
      );
      if (
        !gate.ordered.some((lesson) => lesson.id === test.courseLessonId) ||
        gate.locked.has(test.courseLessonId)
      ) {
        throw new ForbiddenException(LESSON_LOCKED_MESSAGE);
      }
    }
    return toStudentDetail(test);
  }

  /**
   * Опублікований тест уроку для студента: зміст без isCorrect і стан спроб поточного циклу.
   * Урок має належати курсу з активним зарахуванням студента і бути відкритим:
   * попередній урок завершено (його тест складено або, без тесту, урок пройдено).
   * lessonId — урок програми курсу (CourseLesson), той самий id, що в /courses/{id}/content.
   */
  async getLessonTest(actor: User, lessonId: string): Promise<LessonTestDto> {
    assertStudent(actor);
    await this.requireOrganization(actor.organizationId);

    const lesson = await this.prisma.courseLesson.findFirst({
      where: {
        id: lessonId,
        course: { organizationId: actor.organizationId },
      },
      select: { id: true, courseId: true, publicationStatus: true },
    });
    if (!lesson) {
      throw new NotFoundException(LESSON_NOT_FOUND_MESSAGE);
    }
    await this.requireAssignedPublishedCourse(actor, lesson.courseId);
    if (lesson.publicationStatus !== CourseLessonPublicationStatus.PUBLISHED) {
      throw new ForbiddenException(LESSON_LOCKED_MESSAGE);
    }
    const gate = await loadLessonGate(
      this.prisma,
      actor.organizationId,
      lesson.courseId,
      actor.id,
    );
    if (
      !gate.ordered.some((item) => item.id === lesson.id) ||
      gate.locked.has(lesson.id)
    ) {
      throw new ForbiddenException(LESSON_LOCKED_MESSAGE);
    }
    const test = await this.prisma.theoryTest.findFirst({
      where: {
        organizationId: actor.organizationId,
        courseLessonId: lesson.id,
        publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
      },
      select: detailSelect,
    });
    const state = gate.tests.get(lesson.id);
    if (!test || !state) {
      throw new NotFoundException(LESSON_TEST_NOT_FOUND_MESSAGE);
    }
    return toLessonTest(test, state);
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
      assertNotArchived(test);
      const type = payload.type ?? test.format;
      const options = payload.options ?? [];
      if (test.publicationStatus === TheoryTestPublicationStatus.PUBLISHED) {
        assertFieldErrors(questionRuleErrors(type, options));
      } else if (options.length > 0) {
        assertFieldErrors(exclusiveCorrectErrors(type, options));
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
          type,
          text: payload.text,
          position,
          ...(options.length > 0
            ? {
                options: {
                  // testId тут не передається: Prisma бере його з питання через складений FK.
                  create: options.map((option, index) => ({
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
    if (
      payload.text === undefined &&
      payload.type === undefined &&
      payload.position === undefined
    ) {
      throw fieldError('body', NO_QUESTION_FIELDS_MESSAGE);
    }

    const updated = await this.withLockedTest(actor, testId, async (tx) => {
      const test = await this.requireTest(tx, actor, testId);
      assertNotArchived(test);
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
      if (payload.type !== undefined && payload.type !== existing.type) {
        assertFieldErrors(
          test.publicationStatus === TheoryTestPublicationStatus.PUBLISHED
            ? questionRuleErrors(payload.type, existing.options)
            : exclusiveCorrectErrors(payload.type, existing.options),
        );
        data.type = payload.type;
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
      assertNotArchived(test);
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
      assertNotArchived(test);
      const question = await this.requireQuestion(
        tx,
        actor,
        testId,
        questionId,
      );
      const projected = projectAdded(
        question.type,
        question.options,
        payload.isCorrect,
      );
      if (test.publicationStatus === TheoryTestPublicationStatus.PUBLISHED) {
        assertFieldErrors(questionRuleErrors(question.type, projected));
      }

      const position = assertInsertPosition(
        question.options.length,
        payload.position,
      );
      await shiftForInsert(question.options, position, this.optionPosition(tx));
      if (payload.isCorrect && isExclusiveFormat(question.type)) {
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
      assertNotArchived(test);
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
            question.type,
            projectUpdated(
              question.type,
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
      if (payload.isCorrect === true && isExclusiveFormat(question.type)) {
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
      assertNotArchived(test);
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
            question.type,
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
      select: { type: true, options: { select: { isCorrect: true } } },
      orderBy: { position: 'asc' },
    });
    assertFieldErrors([
      ...testPublicationErrors(test),
      ...publicationErrors(questions),
    ]);
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
    await this.assertTeacherCourse(tx, actor, test.courseId);
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
    db: Prisma.TransactionClient | PrismaService,
    actor: User,
    courseId: string,
  ): Promise<{ id: string; status: CourseStatus }> {
    const course = await db.course.findFirst({
      where: { id: courseId, organizationId: actor.organizationId },
      select: { id: true, status: true },
    });
    if (!course) {
      throw new NotFoundException(COURSE_NOT_FOUND_MESSAGE);
    }
    await this.assertTeacherCourse(db, actor, course.id);
    return course;
  }

  /** Викладач читає і змінює тести лише курсів, призначених його групам. */
  private async assertTeacherCourse(
    db: Prisma.TransactionClient | PrismaService,
    actor: User,
    courseId: string,
  ): Promise<void> {
    if (actor.role !== UserRole.TEACHER) {
      return;
    }
    const group = await db.group.findFirst({
      where: {
        organizationId: actor.organizationId,
        teacherId: actor.id,
        courseId,
      },
      select: { id: true },
    });
    if (!group) {
      throw new ForbiddenException('Insufficient permissions');
    }
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
        publicationStatus: { not: TheoryTestPublicationStatus.ARCHIVED },
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
    payload.lessonId !== undefined ||
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
