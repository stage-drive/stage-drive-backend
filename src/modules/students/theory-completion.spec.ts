import {
  CoursePublicationStatus,
  CourseStatus,
  EnrollmentStatus,
  TheoryTestAttemptStatus,
  TrainingStatus,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  REQUIRED_PRACTICE_MINUTES,
  syncTheoryCompletion,
} from './theory-completion';

describe('syncTheoryCompletion', () => {
  const organizationId = 'org-1';
  const studentId = 'student-1';
  const courseId = 'course-1';

  type Overrides = {
    profile?: Record<string, unknown> | null;
    lessons?: Array<{ id: string }>;
    /** Уроки, позначені пройденими. */
    completed?: string[];
    /** Опубліковані тести уроків. */
    lessonTests?: Array<{ id: string; lessonId: string }>;
    lessonAttempts?: Array<{
      testId: string;
      status: TheoryTestAttemptStatus;
      cycle?: number;
    }>;
    /** Опубліковані тести всього курсу (без уроку). */
    courseTests?: Array<{ id: string }>;
    passedCourseTests?: string[];
  };

  function tx(overrides: Overrides) {
    const studentUpdate = jest.fn().mockResolvedValue({});
    const enrollmentUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const lessons = overrides.lessons ?? [{ id: 'lesson-1' }];
    const client = {
      student: {
        findUnique: jest.fn().mockResolvedValue(
          overrides.profile === undefined
            ? {
                id: 'profile-1',
                organizationId,
                trainingStatus: TrainingStatus.ACTIVE,
                group: {
                  course: {
                    id: courseId,
                    publicationStatus: CoursePublicationStatus.PUBLISHED,
                    status: CourseStatus.ACTIVE,
                  },
                },
              }
            : overrides.profile,
        ),
        update: studentUpdate,
      },
      courseLesson: {
        findMany: jest.fn().mockResolvedValue(
          lessons.map((lesson, index) => ({
            id: lesson.id,
            position: index + 1,
            chapter: { position: 1 },
          })),
        ),
      },
      courseLessonCompletion: {
        findMany: jest.fn().mockResolvedValue(
          (overrides.completed ?? ['lesson-1']).map((lessonId) => ({
            lessonId,
            testCycle: 1,
          })),
        ),
      },
      theoryTest: {
        findMany: jest
          .fn()
          .mockImplementation(
            ({ where }: { where: { courseLessonId: unknown } }) =>
              where.courseLessonId === null
                ? Promise.resolve(overrides.courseTests ?? [])
                : Promise.resolve(
                    (overrides.lessonTests ?? []).map((test) => ({
                      id: test.id,
                      courseLessonId: test.lessonId,
                      maxAttempts: 3,
                    })),
                  ),
          ),
      },
      theoryTestAttempt: {
        findMany: jest
          .fn()
          .mockImplementation(({ where }: { where: { status?: unknown } }) =>
            where.status === TheoryTestAttemptStatus.PASSED
              ? Promise.resolve(
                  (overrides.passedCourseTests ?? []).map((testId) => ({
                    testId,
                  })),
                )
              : Promise.resolve(
                  (overrides.lessonAttempts ?? []).map((attempt, index) => ({
                    id: `attempt-${index}`,
                    expiresAt: null,
                    cycle: 1,
                    ...attempt,
                  })),
                ),
          ),
      },
      theoryTestResult: { findUnique: jest.fn() },
      enrollment: { updateMany: enrollmentUpdate },
    };
    return { client, studentUpdate, enrollmentUpdate };
  }

  async function run(client: ReturnType<typeof tx>['client']) {
    return syncTheoryCompletion(
      client as unknown as Prisma.TransactionClient,
      studentId,
      organizationId,
    );
  }

  it('sets THEORY_COMPLETED when every published lesson without a test is completed', async () => {
    const { client, studentUpdate, enrollmentUpdate } = tx({});

    await expect(run(client)).resolves.toBe(true);

    expect(studentUpdate).toHaveBeenCalledWith({
      where: { id: 'profile-1' },
      data: { trainingStatus: TrainingStatus.THEORY_COMPLETED },
    });
    expect(enrollmentUpdate).toHaveBeenCalledWith({
      where: {
        studentId,
        status: EnrollmentStatus.ACTIVE,
        group: { organizationId },
      },
      data: { status: EnrollmentStatus.COMPLETED },
    });
    expect(REQUIRED_PRACTICE_MINUTES).toBe(2400);
  });

  it('completes theory from a PASSED lesson test even when the lesson was never marked completed', async () => {
    const { client, studentUpdate } = tx({
      completed: [],
      lessonTests: [{ id: 'test-1', lessonId: 'lesson-1' }],
      lessonAttempts: [
        { testId: 'test-1', status: TheoryTestAttemptStatus.PASSED },
      ],
    });

    await expect(run(client)).resolves.toBe(true);

    expect(studentUpdate).toHaveBeenCalledTimes(1);
  });

  it('does not complete theory while a lesson test is only FAILED, even if the lesson is completed', async () => {
    const { client, studentUpdate } = tx({
      completed: ['lesson-1'],
      lessonTests: [{ id: 'test-1', lessonId: 'lesson-1' }],
      lessonAttempts: [
        { testId: 'test-1', status: TheoryTestAttemptStatus.FAILED },
        { testId: 'test-1', status: TheoryTestAttemptStatus.EXPIRED },
      ],
    });

    await expect(run(client)).resolves.toBe(false);

    expect(studentUpdate).not.toHaveBeenCalled();
  });

  it('ignores a result written by the client through the deprecated endpoint', async () => {
    const { client, studentUpdate } = tx({
      completed: ['lesson-1'],
      lessonTests: [{ id: 'test-1', lessonId: 'lesson-1' }],
      lessonAttempts: [],
    });
    client.theoryTestResult.findUnique.mockResolvedValue({ status: 'PASSED' });

    await expect(run(client)).resolves.toBe(false);

    expect(client.theoryTestResult.findUnique).not.toHaveBeenCalled();
    expect(studentUpdate).not.toHaveBeenCalled();
  });

  it('does not use attendance and stays ACTIVE while another lesson is still open', async () => {
    const { client, studentUpdate } = tx({
      lessons: [{ id: 'lesson-1' }, { id: 'lesson-2' }],
      completed: ['lesson-1'],
      lessonTests: [{ id: 'test-1', lessonId: 'lesson-1' }],
      lessonAttempts: [
        { testId: 'test-1', status: TheoryTestAttemptStatus.PASSED },
      ],
    });

    await expect(run(client)).resolves.toBe(false);

    expect(studentUpdate).not.toHaveBeenCalled();
  });

  it('requires every published course-level test to be passed', async () => {
    const pending = tx({
      courseTests: [{ id: 'course-test-1' }, { id: 'course-test-2' }],
      passedCourseTests: ['course-test-1'],
    });

    await expect(run(pending.client)).resolves.toBe(false);
    expect(pending.studentUpdate).not.toHaveBeenCalled();

    const done = tx({
      courseTests: [{ id: 'course-test-1' }, { id: 'course-test-2' }],
      passedCourseTests: ['course-test-1', 'course-test-2'],
    });

    await expect(run(done.client)).resolves.toBe(true);
    expect(done.studentUpdate).toHaveBeenCalledTimes(1);
  });

  it('does not complete theory for a course without published lessons', async () => {
    const { client, studentUpdate } = tx({ lessons: [], completed: [] });

    await expect(run(client)).resolves.toBe(false);

    expect(studentUpdate).not.toHaveBeenCalled();
  });

  it('does not overwrite a status that is no longer ACTIVE', async () => {
    const { client, studentUpdate } = tx({
      profile: {
        id: 'profile-1',
        organizationId,
        trainingStatus: TrainingStatus.PRACTICE,
        group: {
          course: {
            id: courseId,
            publicationStatus: CoursePublicationStatus.PUBLISHED,
            status: CourseStatus.ACTIVE,
          },
        },
      },
    });

    await expect(run(client)).resolves.toBe(false);

    expect(studentUpdate).not.toHaveBeenCalled();
    expect(client.courseLesson.findMany).not.toHaveBeenCalled();
  });
});
