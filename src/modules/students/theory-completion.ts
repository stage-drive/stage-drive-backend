import {
  CoursePublicationStatus,
  CourseStatus,
  EnrollmentStatus,
  LessonStatus,
  Prisma,
  TheoryTestStatus,
  TrainingStatus,
} from '@prisma/client';

/** На статусі PRACTICE студент відкатує рівно стільки годин, і лише тоді відкривається EXAM. */
export const REQUIRED_PRACTICE_HOURS = 40;
export const REQUIRED_PRACTICE_MINUTES = REQUIRED_PRACTICE_HOURS * 60;

export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/**
 * Ставить THEORY_COMPLETED, коли студент у ACTIVE, призначений курс опубліковано,
 * кожен його урок має проходження і тест курсу складено (PASSED).
 * Журнал очної відвідуваності не читається.
 * Порожній курс теорію не закриває.
 */
export async function syncTheoryCompletion(
  tx: Prisma.TransactionClient,
  studentId: string,
  organizationId: string,
): Promise<void> {
  const profile = await tx.student.findUnique({
    where: { userId: studentId },
    select: {
      id: true,
      organizationId: true,
      trainingStatus: true,
      group: {
        select: {
          course: {
            select: {
              id: true,
              publicationStatus: true,
              status: true,
            },
          },
        },
      },
    },
  });
  const course = profile?.group?.course;
  if (
    !profile ||
    profile.organizationId !== organizationId ||
    profile.trainingStatus !== TrainingStatus.ACTIVE ||
    !course ||
    course.publicationStatus !== CoursePublicationStatus.PUBLISHED ||
    course.status !== CourseStatus.ACTIVE
  ) {
    return;
  }

  const lessons = await tx.courseLesson.findMany({
    where: { courseId: course.id },
    select: { id: true },
  });
  if (lessons.length === 0) {
    return;
  }

  const completedLessonCount = await tx.courseLessonCompletion.count({
    where: {
      organizationId,
      courseId: course.id,
      studentId,
      lessonId: { in: lessons.map((lesson) => lesson.id) },
    },
  });
  if (completedLessonCount < lessons.length) {
    return;
  }

  const test = await tx.theoryTestResult.findUnique({
    where: { studentId_courseId: { studentId, courseId: course.id } },
    select: { status: true },
  });
  if (test?.status !== TheoryTestStatus.PASSED) {
    return;
  }

  await tx.student.update({
    where: { id: profile.id },
    data: { trainingStatus: TrainingStatus.THEORY_COMPLETED },
  });
  await tx.enrollment.updateMany({
    where: {
      studentId,
      status: EnrollmentStatus.ACTIVE,
      group: { organizationId },
    },
    data: { status: EnrollmentStatus.COMPLETED },
  });
}

export async function completedPracticeMinutes(
  tx: Prisma.TransactionClient,
  studentId: string,
  organizationId: string,
): Promise<number> {
  const lessons = await tx.drivingLesson.findMany({
    where: {
      studentId,
      organizationId,
      status: LessonStatus.COMPLETED,
    },
    select: { durationMin: true },
  });
  return lessons.reduce((total, lesson) => total + lesson.durationMin, 0);
}
