import {
  CoursePublicationStatus,
  CourseStatus,
  EnrollmentStatus,
  LessonStatus,
  Prisma,
  TheoryTestAttemptStatus,
  TheoryTestPublicationStatus,
  TrainingStatus,
} from '@prisma/client';
import { loadLessonGate } from '../courses/lesson-gate';

/** На статусі PRACTICE студент відкатує рівно стільки годин, і лише тоді відкривається EXAM. */
export const REQUIRED_PRACTICE_HOURS = 40;
export const REQUIRED_PRACTICE_MINUTES = REQUIRED_PRACTICE_HOURS * 60;

export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/**
 * Ставить THEORY_COMPLETED, коли студент у ACTIVE, призначений курс опубліковано
 * і кожен його опублікований урок завершено: тест уроку складено (PASSED),
 * а якщо в уроку немає опублікованого тесту — урок позначено пройденим.
 * Опубліковані тести всього курсу (старий формат без уроку) теж мають бути складені.
 * Результат береться зі спроб, які оцінив сервер. Старий запис результату всього курсу
 * на завершення теорії не впливає.
 * Журнал очної відвідуваності не читається.
 * Порожній курс теорію не закриває.
 * Повертає true, якщо навчальний статус щойно змінено.
 */
export async function syncTheoryCompletion(
  tx: Prisma.TransactionClient,
  studentId: string,
  organizationId: string,
): Promise<boolean> {
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
    return false;
  }

  const gate = await loadLessonGate(tx, organizationId, course.id, studentId);
  if (gate.ordered.length === 0 || gate.cleared.size < gate.ordered.length) {
    return false;
  }

  const courseTests = await tx.theoryTest.findMany({
    where: {
      organizationId,
      courseId: course.id,
      courseLessonId: null,
      publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
    },
    select: { id: true },
  });
  if (courseTests.length > 0) {
    const passedTests = await tx.theoryTestAttempt.findMany({
      where: {
        organizationId,
        studentId,
        status: TheoryTestAttemptStatus.PASSED,
        testId: { in: courseTests.map((test) => test.id) },
      },
      select: { testId: true },
      distinct: ['testId'],
    });
    if (passedTests.length < courseTests.length) {
      return false;
    }
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
  return true;
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
