import {
  CoursePublicationStatus,
  CourseStatus,
  EnrollmentStatus,
  TheoryTestStatus,
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

  function tx(overrides: {
    profile?: Record<string, unknown> | null;
    lessons?: Array<{ id: string }>;
    completed?: number;
    testStatus?: TheoryTestStatus | null;
  }) {
    const studentUpdate = jest.fn().mockResolvedValue({});
    const enrollmentUpdate = jest.fn().mockResolvedValue({ count: 1 });
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
        findMany: jest
          .fn()
          .mockResolvedValue(overrides.lessons ?? [{ id: 'lesson-1' }]),
      },
      courseLessonCompletion: {
        count: jest.fn().mockResolvedValue(overrides.completed ?? 1),
      },
      theoryTestResult: {
        findUnique: jest.fn().mockResolvedValue(
          overrides.testStatus === undefined
            ? { status: TheoryTestStatus.PASSED }
            : overrides.testStatus
              ? { status: overrides.testStatus }
              : null,
        ),
      },
      enrollment: { updateMany: enrollmentUpdate },
    };
    return { client, studentUpdate, enrollmentUpdate };
  }

  it('sets THEORY_COMPLETED when every published lesson is completed and the test is PASSED', async () => {
    const { client, studentUpdate, enrollmentUpdate } = tx({});

    await syncTheoryCompletion(
      client as unknown as Prisma.TransactionClient,
      studentId,
      organizationId,
    );

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

  it('does not use attendance and stays ACTIVE when the test is not PASSED', async () => {
    const { client, studentUpdate } = tx({
      testStatus: TheoryTestStatus.FAILED,
    });

    await syncTheoryCompletion(
      client as unknown as Prisma.TransactionClient,
      studentId,
      organizationId,
    );

    expect(client.courseLessonCompletion.count).toHaveBeenCalled();
    expect(studentUpdate).not.toHaveBeenCalled();
  });

  it('does not complete theory when a published lesson is still open', async () => {
    const { client, studentUpdate } = tx({
      lessons: [{ id: 'lesson-1' }, { id: 'lesson-2' }],
      completed: 1,
    });

    await syncTheoryCompletion(
      client as unknown as Prisma.TransactionClient,
      studentId,
      organizationId,
    );

    expect(studentUpdate).not.toHaveBeenCalled();
    expect(client.theoryTestResult.findUnique).not.toHaveBeenCalled();
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

    await syncTheoryCompletion(
      client as unknown as Prisma.TransactionClient,
      studentId,
      organizationId,
    );

    expect(studentUpdate).not.toHaveBeenCalled();
    expect(client.courseLesson.findMany).not.toHaveBeenCalled();
  });
});
