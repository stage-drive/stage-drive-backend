import { execFileSync } from 'child_process';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  CourseLessonPublicationStatus,
  CoursePublicationStatus,
  CourseStatus,
  EnrollmentStatus,
  GroupStatus,
  PrismaClient,
  TheoryTestAttemptStatus,
  TheoryTestFormat,
  TheoryTestPublicationStatus,
  TrainingStatus,
  User,
  UserRole,
} from '@prisma/client';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { CourseProgressService } from '../../src/modules/courses/course-progress.service';
import { CourseStructureService } from '../../src/modules/courses/course-structure.service';
import { TestAttemptsService } from '../../src/modules/tests/test-attempts.service';
import type { TestDetailDto } from '../../src/modules/tests/tests.dto';
import { TestsService } from '../../src/modules/tests/tests.service';
import type { PrismaService } from '../../src/prisma/prisma.service';

const RETRY_MESSAGE = 'Пройдіть урок ще раз.';

type School = Awaited<ReturnType<typeof createSchoolFixture>>;
let prismaClient: PrismaClient;
let sequence = 0;

async function createSchoolFixture(prisma: PrismaClient) {
  sequence += 1;
  const tag = String(sequence);
  const organization = await prisma.organization.create({
    data: {
      name: `Tests School ${tag}`,
      slug: `tests-school-${tag}`,
      email: `tests-${tag}@example.com`,
    },
  });
  const person = (role: UserRole, label: string) => ({
    organizationId: organization.id,
    email: `${label}-${tag}@tests.example.com`,
    firstName: 'Test',
    lastName: label,
    role,
  });
  const admin = await prisma.user.create({
    data: person(UserRole.ADMIN, 'admin'),
  });
  const teacher = await prisma.user.create({
    data: person(UserRole.TEACHER, 'teacher'),
  });
  const otherTeacher = await prisma.user.create({
    data: person(UserRole.TEACHER, 'teacher2'),
  });
  const outsider = await prisma.user.create({
    data: person(UserRole.TEACHER, 'outsider'),
  });
  const course = await prisma.course.create({
    data: {
      organizationId: organization.id,
      name: `Курс ${tag}`,
      status: CourseStatus.ACTIVE,
      publicationStatus: CoursePublicationStatus.PUBLISHED,
    },
  });
  const chapter = await prisma.courseChapter.create({
    data: { courseId: course.id, title: 'Розділ', position: 1 },
  });
  const lesson1 = await prisma.courseLesson.create({
    data: {
      courseId: course.id,
      chapterId: chapter.id,
      title: 'Урок 1',
      position: 1,
      publicationStatus: CourseLessonPublicationStatus.PUBLISHED,
    },
  });
  const lesson2 = await prisma.courseLesson.create({
    data: {
      courseId: course.id,
      chapterId: chapter.id,
      title: 'Урок 2',
      position: 2,
      publicationStatus: CourseLessonPublicationStatus.PUBLISHED,
    },
  });
  const group = await prisma.group.create({
    data: {
      name: `Група ${tag}`,
      status: GroupStatus.ACTIVE,
      organizationId: organization.id,
      teacherId: teacher.id,
      courseId: course.id,
    },
  });
  const otherGroup = await prisma.group.create({
    data: {
      name: `Група-2 ${tag}`,
      status: GroupStatus.ACTIVE,
      organizationId: organization.id,
      teacherId: otherTeacher.id,
      courseId: course.id,
    },
  });
  async function enroll(label: string, groupId: string): Promise<User> {
    const student = await prisma.user.create({
      data: {
        ...person(UserRole.STUDENT, label),
        studentProfile: {
          create: {
            organizationId: organization.id,
            trainingStatus: TrainingStatus.ACTIVE,
            groupId,
          },
        },
      },
    });
    await prisma.enrollment.create({
      data: { groupId, studentId: student.id, status: EnrollmentStatus.ACTIVE },
    });
    return student;
  }
  const student = await enroll('student', group.id);
  const otherStudent = await enroll('student2', otherGroup.id);
  return {
    organization,
    admin,
    teacher,
    otherTeacher,
    outsider,
    course,
    lesson1,
    lesson2,
    group,
    otherGroup,
    student,
    otherStudent,
  };
}

function correct(question: TestDetailDto['questions'][number]): string[] {
  return question.options
    .filter((option) => option.isCorrect)
    .map((option) => option.id);
}

function wrong(question: TestDetailDto['questions'][number]): string[] {
  const option = question.options.find((candidate) => !candidate.isCorrect);
  return option ? [option.id] : [];
}

/**
 * Real TestsService / TestAttemptsService / CourseProgressService / CourseStructureService
 * against real Postgres: mocks cannot see Prisma input validation, partial unique indexes,
 * row locks and CHECK constraints, which the lesson-test flow depends on.
 */
describe('Lesson tests (integration, real Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let tests: TestsService;
  let attempts: TestAttemptsService;
  let progress: CourseProgressService;
  let structure: CourseStructureService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const databaseUrl = container.getConnectionUri();

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
      // На Windows npx — це npx.cmd, який без оболонки не запускається.
      shell: process.platform === 'win32',
    });

    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    });
    prismaClient = prisma;
    await prisma.$connect();

    const service = prisma as unknown as PrismaService;
    tests = new TestsService(service);
    attempts = new TestAttemptsService(service);
    progress = new CourseProgressService(service);
    structure = new CourseStructureService(service);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  function school(): Promise<School> {
    return createSchoolFixture(prismaClient);
  }

  /** Тест уроку з питаннями всіх трьох типів, опублікований через UC-003. */
  async function publishedTest(
    fixture: School,
    lessonId: string,
    timeLimitMinutes: number | null = 10,
  ): Promise<TestDetailDto> {
    const { admin } = fixture;
    const created = await tests.create(admin, {
      lessonId,
      name: `Тест ${lessonId.slice(0, 8)}`,
      passingScore: 60,
      timeLimitMinutes,
    });
    await tests.createQuestion(admin, created.id, {
      text: 'Одна відповідь',
      type: TheoryTestFormat.SINGLE_CHOICE,
      options: [
        { text: 'Так', isCorrect: true },
        { text: 'Ні', isCorrect: false },
        { text: 'Не знаю', isCorrect: false },
      ],
    });
    await tests.createQuestion(admin, created.id, {
      text: 'Кілька відповідей',
      type: TheoryTestFormat.MULTIPLE_CHOICE,
      options: [
        { text: 'Перша', isCorrect: true },
        { text: 'Друга', isCorrect: true },
        { text: 'Третя', isCorrect: false },
      ],
    });
    await tests.createQuestion(admin, created.id, {
      text: 'Так чи ні',
      type: TheoryTestFormat.TRUE_FALSE,
      options: [
        { text: 'Так', isCorrect: true },
        { text: 'Ні', isCorrect: false },
      ],
    });
    await tests.changePublication(admin, created.id, {
      publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
    });
    return tests.get(admin, created.id);
  }

  it('publishes a lesson test only after UC-003 validation', async () => {
    const fixture = await school();
    const { admin, lesson1 } = fixture;
    const draft = await tests.create(admin, {
      lessonId: lesson1.id,
      name: 'Чернетка',
      passingScore: 60,
    });
    expect(draft).toMatchObject({
      courseLessonId: lesson1.id,
      courseId: fixture.course.id,
      maxAttempts: 3,
      publicationStatus: TheoryTestPublicationStatus.DRAFT,
    });

    const publish = () =>
      tests.changePublication(admin, draft.id, {
        publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
      });
    await expect(publish()).rejects.toBeInstanceOf(BadRequestException);

    const question = await tests.createQuestion(admin, draft.id, {
      text: 'Без правильної відповіді',
      type: TheoryTestFormat.SINGLE_CHOICE,
      options: [
        { text: 'Перша', isCorrect: false },
        { text: 'Друга', isCorrect: false },
      ],
    });
    await expect(publish()).rejects.toBeInstanceOf(BadRequestException);

    await tests.updateOption(
      admin,
      draft.id,
      question.id,
      question.options[0].id,
      {
        isCorrect: true,
      },
    );
    await expect(publish()).resolves.toMatchObject({
      publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
    });

    await expect(
      tests.create(admin, {
        lessonId: lesson1.id,
        name: 'Другий тест уроку',
        passingScore: 60,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      tests.list(admin, { lessonId: lesson1.id }),
    ).resolves.toMatchObject({ tests: [{ id: draft.id }] });
  });

  it('runs the whole student flow and grades on the server', async () => {
    const fixture = await school();
    const { student, lesson1, lesson2, course } = fixture;
    const detail = await publishedTest(fixture, lesson1.id);
    const [q1, q2, q3] = detail.questions;

    const lessonTest = await tests.getLessonTest(student, lesson1.id);
    expect(JSON.stringify(lessonTest)).not.toContain('isCorrect');
    expect(lessonTest).toMatchObject({
      id: detail.id,
      lessonId: lesson1.id,
      maxAttempts: 3,
      passed: false,
      attemptsUsed: 0,
      attemptsLeft: 3,
      nextAttemptAvailable: true,
      lockedNextUntilPassed: true,
    });
    await expect(
      tests.getLessonTest(student, lesson2.id),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const started = await attempts.start(student, detail.id);
    expect(started).toMatchObject({
      status: 'IN_PROGRESS',
      result: null,
      cycle: 1,
      attemptNumber: 1,
      attemptsUsed: 1,
      attemptsLeft: 2,
      scorePercent: null,
      correctCount: null,
      totalQuestions: 3,
      maxPoints: 3,
      answers: [],
    });
    expect(started.expiresAt).not.toBeNull();
    expect(started.questions.map((question) => question.type)).toEqual([
      TheoryTestFormat.SINGLE_CHOICE,
      TheoryTestFormat.MULTIPLE_CHOICE,
      TheoryTestFormat.TRUE_FALSE,
    ]);
    expect(JSON.stringify(started)).not.toContain('isCorrect');

    await expect(attempts.start(student, detail.id)).rejects.toMatchObject({
      response: { reason: 'IN_PROGRESS', attemptId: started.id },
    });

    await attempts.saveAnswers(student, started.id, {
      answers: [{ questionId: q1.id, optionIds: correct(q1) }],
    });
    const merged = await attempts.saveAnswers(student, started.id, {
      answers: [{ questionId: q2.id, optionIds: correct(q2) }],
    });
    expect(merged.answers).toHaveLength(2);
    expect(JSON.stringify(merged)).not.toContain('isCorrect');
    const cleared = await attempts.saveAnswers(student, started.id, {
      answers: [{ questionId: q1.id, optionIds: [] }],
    });
    expect(cleared.answers).toEqual([
      { questionId: q2.id, optionIds: correct(q2) },
    ]);
    await expect(
      attempts.saveAnswers(student, started.id, {
        answers: [
          {
            questionId: q1.id,
            optionIds: [q1.options[0].id, q1.options[1].id],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const resumed = await attempts.get(student, started.id);
    expect(resumed.answers).toEqual(cleared.answers);

    // Лише q2 відповідено правильно: 1 з 3 = 33%, поріг 60.
    const failed = await attempts.submit(student, started.id, {});
    expect(failed).toMatchObject({
      status: 'COMPLETED',
      result: 'FAILED',
      scorePercent: 33,
      earnedPoints: 1,
      maxPoints: 3,
      correctCount: 1,
      totalQuestions: 3,
      attemptNumber: 1,
      attemptsUsed: 1,
      attemptsLeft: 2,
    });
    expect(failed.questions[0].options[0]).toHaveProperty('isCorrect');
    await expect(
      tests.getLessonTest(student, lesson2.id),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const second = await attempts.start(student, detail.id);
    expect(second).toMatchObject({ attemptNumber: 2, attemptsLeft: 1 });
    const passed = await attempts.submit(student, second.id, {
      answers: [q1, q2, q3].map((question) => ({
        questionId: question.id,
        optionIds: correct(question),
      })),
    });
    expect(passed).toMatchObject({
      status: 'COMPLETED',
      result: 'PASSED',
      scorePercent: 100,
      correctCount: 3,
      attemptNumber: 2,
      attemptsLeft: 1,
    });
    const repeated = await attempts.submit(student, second.id, { answers: [] });
    expect(repeated).toMatchObject({ result: 'PASSED', scorePercent: 100 });
    await expect(
      prisma.theoryTestAttempt.count({
        where: {
          studentId: student.id,
          status: TheoryTestAttemptStatus.PASSED,
        },
      }),
    ).resolves.toBe(1);
    await expect(attempts.start(student, detail.id)).rejects.toMatchObject({
      response: { reason: 'ALREADY_PASSED' },
    });

    // PASSED відкриває наступний урок: тепер він без тесту, а не закритий.
    await expect(
      tests.getLessonTest(student, lesson2.id),
    ).rejects.toBeInstanceOf(NotFoundException);

    const content = await structure.getStudentContent(student, course.id);
    const lessons = content.chapters.flatMap((chapter) => chapter.lessons);
    expect(lessons[0].test).toMatchObject({
      id: detail.id,
      passed: true,
      attemptsUsed: 2,
      attemptsLeft: 1,
      lockedNextUntilPassed: false,
    });
    expect(lessons[1]).toMatchObject({ locked: false, test: null });

    const own = await progress.getOwn(student, course.id);
    expect(own).toMatchObject({ completedLessonCount: 1, percent: 50 });
    expect(own.lessons[0]).toMatchObject({
      completed: true,
      passed: true,
      hasTest: true,
      retryMessage: null,
    });
    expect(own.lessons[0].completedAt).not.toBeNull();

    // Урок без тесту завершується позначкою, і теорія закривається.
    await progress.completeLesson(student, course.id, lesson2.id);
    const profile = await prisma.student.findUniqueOrThrow({
      where: { userId: student.id },
    });
    expect(profile.trainingStatus).toBe(TrainingStatus.THEORY_COMPLETED);

    const own2 = await attempts.listOwn(student, detail.id);
    expect(own2).toMatchObject({ passed: true, cycle: 1, attemptsUsed: 2 });
    expect(own2.attempts).toHaveLength(2);
  });

  it('opens a new cycle only after all attempts are spent and the lesson is passed again', async () => {
    const fixture = await school();
    const { student, lesson1, lesson2, course } = fixture;
    const detail = await publishedTest(fixture, lesson1.id);
    const sheet = detail.questions.map((question) => ({
      questionId: question.id,
      optionIds: wrong(question),
    }));

    // Позначка «пройдено» без складеного тесту наступний урок не відкриває.
    await progress.completeLesson(student, course.id, lesson1.id);
    await expect(
      progress.completeLesson(student, course.id, lesson2.id),
    ).rejects.toBeInstanceOf(ForbiddenException);

    let last = await attempts.submit(
      student,
      (await attempts.start(student, detail.id)).id,
      { answers: sheet },
    );
    expect(last).toMatchObject({ result: 'FAILED', attemptsLeft: 2 });
    expect(last.message).toBeUndefined();
    last = await attempts.submit(
      student,
      (await attempts.start(student, detail.id)).id,
      { answers: sheet },
    );
    last = await attempts.submit(
      student,
      (await attempts.start(student, detail.id)).id,
      { answers: sheet },
    );
    expect(last).toMatchObject({
      result: 'FAILED',
      attemptNumber: 3,
      attemptsUsed: 3,
      attemptsLeft: 0,
      message: RETRY_MESSAGE,
    });

    await expect(attempts.start(student, detail.id)).rejects.toMatchObject({
      response: { reason: 'ATTEMPTS_EXHAUSTED', message: RETRY_MESSAGE },
    });
    const exhausted = await progress.getOwn(student, course.id);
    expect(exhausted.lessons[0]).toMatchObject({
      completed: false,
      retryMessage: RETRY_MESSAGE,
      test: { passed: false, attemptsLeft: 0, nextAttemptAvailable: false },
    });
    const exhaustedTest = await tests.getLessonTest(student, lesson1.id);
    expect(exhaustedTest).toMatchObject({
      attemptsLeft: 0,
      message: RETRY_MESSAGE,
    });

    await progress.completeLesson(student, course.id, lesson1.id);
    await progress.completeLesson(student, course.id, lesson1.id);
    await expect(
      prisma.courseLessonCompletion.findFirstOrThrow({
        where: { studentId: student.id, lessonId: lesson1.id },
      }),
    ).resolves.toMatchObject({ testCycle: 2 });
    await expect(
      tests.getLessonTest(student, lesson1.id),
    ).resolves.toMatchObject({
      attemptsUsed: 0,
      attemptsLeft: 3,
      nextAttemptAvailable: true,
    });

    const fresh = await attempts.start(student, detail.id);
    expect(fresh).toMatchObject({
      cycle: 2,
      attemptNumber: 1,
      attemptsUsed: 1,
      attemptsLeft: 2,
    });
    const own = await attempts.listOwn(student, detail.id);
    expect(own).toMatchObject({ cycle: 2, attemptsUsed: 1, attemptsLeft: 2 });
    expect(own.attempts).toHaveLength(4);
    expect(own.message).toBeUndefined();
    const history = await attempts.listMyAttempts(student, {
      lessonId: lesson1.id,
      status: 'COMPLETED',
      result: 'FAILED',
    });
    expect(history.pagination).toMatchObject({ total: 3 });
    expect(history.attempts.every((item) => item.cycle === 1)).toBe(true);
  });

  it('lets only the server decide when an attempt has expired', async () => {
    const fixture = await school();
    const { student, lesson1 } = fixture;
    const detail = await publishedTest(fixture, lesson1.id, 1);
    const sheet = detail.questions.map((question) => ({
      questionId: question.id,
      optionIds: correct(question),
    }));

    const started = await attempts.start(student, detail.id);
    await expect(attempts.expire(student, started.id)).resolves.toMatchObject({
      status: 'IN_PROGRESS',
    });

    const longAgo = new Date(Date.now() - 5 * 60_000);
    await prisma.theoryTestAttempt.update({
      where: { id: started.id },
      data: { startedAt: longAgo, expiresAt: new Date(Date.now() - 60_000) },
    });
    await expect(
      attempts.saveAnswers(student, started.id, { answers: [] }),
    ).rejects.toMatchObject({ response: { status: 'EXPIRED' } });
    await expect(
      prisma.theoryTestAttempt.findUniqueOrThrow({ where: { id: started.id } }),
    ).resolves.toMatchObject({
      status: TheoryTestAttemptStatus.EXPIRED,
      score: null,
    });

    const late = await attempts.submit(student, started.id, { answers: sheet });
    expect(late).toMatchObject({
      status: 'EXPIRED',
      result: null,
      scorePercent: null,
      attemptsUsed: 1,
      attemptsLeft: 2,
    });
    expect(JSON.stringify(late)).not.toContain('isCorrect');
    await expect(attempts.expire(student, started.id)).resolves.toMatchObject({
      status: 'EXPIRED',
    });

    const next = await attempts.start(student, detail.id);
    expect(next).toMatchObject({ attemptNumber: 2, attemptsLeft: 1 });
  });

  it('starts only one attempt when the student double-clicks', async () => {
    const fixture = await school();
    const detail = await publishedTest(fixture, fixture.lesson1.id);

    const results = await Promise.allSettled([
      attempts.start(fixture.student, detail.id),
      attempts.start(fixture.student, detail.id),
    ]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    const rejected = results.find((item) => item.status === 'rejected');
    expect(rejected.reason).toBeInstanceOf(ConflictException);
    await expect(
      prisma.theoryTestAttempt.count({
        where: {
          studentId: fixture.student.id,
          status: TheoryTestAttemptStatus.IN_PROGRESS,
        },
      }),
    ).resolves.toBe(1);
  });

  it('shows staff only the attempts they are allowed to see', async () => {
    const fixture = await school();
    const foreign = await school();
    const detail = await publishedTest(fixture, fixture.lesson1.id);
    const sheet = detail.questions.map((question) => ({
      questionId: question.id,
      optionIds: correct(question),
    }));
    const first = await attempts.start(fixture.student, detail.id);
    await attempts.submit(fixture.student, first.id, { answers: sheet });
    const second = await attempts.start(fixture.otherStudent, detail.id);

    const all = await attempts.listForTest(fixture.admin, detail.id, {});
    expect(all.pagination).toMatchObject({ total: 2, totalPages: 1 });
    const own = all.attempts.find((item) => item.id === first.id);
    expect(own).toMatchObject({
      studentId: fixture.student.id,
      groupId: fixture.group.id,
      groupName: fixture.group.name,
      status: 'COMPLETED',
      result: 'PASSED',
      scorePercent: 100,
      testName: detail.name,
    });
    expect(JSON.stringify(all)).not.toContain('isCorrect');

    const mine = await attempts.listForTest(fixture.teacher, detail.id, {});
    expect(mine.attempts.map((item) => item.id)).toEqual([first.id]);
    const theirs = await attempts.listAttempts(fixture.otherTeacher, {});
    expect(theirs.attempts.map((item) => item.id)).toEqual([second.id]);
    await expect(
      attempts.listAttempts(fixture.teacher, {
        groupId: fixture.otherGroup.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      attempts.listForTest(fixture.outsider, detail.id, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      attempts.listAttempts(fixture.outsider, {}),
    ).resolves.toMatchObject({ attempts: [], pagination: { total: 0 } });

    await expect(
      attempts.listAttempts(fixture.admin, { groupId: fixture.group.id }),
    ).resolves.toMatchObject({ pagination: { total: 1 } });
    await expect(
      attempts.listAttempts(fixture.admin, {
        studentId: fixture.otherStudent.id,
      }),
    ).resolves.toMatchObject({ pagination: { total: 1 } });
    await expect(
      attempts.listAttempts(fixture.admin, {
        testId: detail.id,
        status: 'COMPLETED',
        result: 'PASSED',
      }),
    ).resolves.toMatchObject({ pagination: { total: 1 } });
    await expect(
      attempts.listAttempts(fixture.admin, { status: 'EXPIRED' }),
    ).resolves.toMatchObject({ pagination: { total: 0 } });
    const page = await attempts.listAttempts(fixture.admin, {
      page: 2,
      limit: 1,
    });
    expect(page).toMatchObject({
      attempts: [{}],
      pagination: { page: 2, limit: 1, total: 2, totalPages: 2 },
    });

    await expect(
      attempts.listAttempts(fixture.student, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      attempts.listForTest(foreign.admin, detail.id, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      attempts.get(foreign.student, first.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      attempts.get(fixture.otherStudent, first.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(tests.get(fixture.outsider, detail.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('archives a test: history stays, students lose access, the lesson accepts a new test', async () => {
    const fixture = await school();
    const { admin, student, lesson1 } = fixture;
    const detail = await publishedTest(fixture, lesson1.id);
    const open = await attempts.start(student, detail.id);

    await expect(tests.archive(admin, detail.id)).resolves.toMatchObject({
      publicationStatus: TheoryTestPublicationStatus.ARCHIVED,
    });
    await expect(
      prisma.theoryTestAttempt.findUniqueOrThrow({ where: { id: open.id } }),
    ).resolves.toMatchObject({ status: TheoryTestAttemptStatus.EXPIRED });
    await expect(
      tests.getLessonTest(student, lesson1.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(attempts.start(student, detail.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      tests.update(admin, detail.id, { name: 'Інша назва' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      attempts.listForTest(admin, detail.id, {}),
    ).resolves.toMatchObject({ pagination: { total: 1 } });

    await expect(
      tests.create(admin, {
        lessonId: lesson1.id,
        name: 'Новий тест уроку',
        passingScore: 50,
      }),
    ).resolves.toMatchObject({ courseLessonId: lesson1.id });
    await expect(
      tests.list(admin, {
        lessonId: lesson1.id,
        publicationStatus: TheoryTestPublicationStatus.ARCHIVED,
      }),
    ).resolves.toMatchObject({ tests: [{ id: detail.id }] });
  });
});
