import {
  CourseLessonPublicationStatus,
  Prisma,
  TheoryTestAttemptStatus,
  TheoryTestPublicationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Скільки спроб має тест, прив’язаний до уроку. */
export const LESSON_TEST_ATTEMPTS = 3;

export const LESSON_RETRY_MESSAGE = 'Пройдіть урок ще раз.';

export const LESSON_LOCKED_MESSAGE =
  'Попередній урок має бути пройдений, а його тест — складений.';

export type GateLesson = {
  id: string;
  position: number;
  chapterPosition: number;
};

export type LessonGate = {
  ordered: GateLesson[];
  completed: Set<string>;
  passed: Set<string>;
  /** lessonId → id опублікованого тесту цього уроку. */
  testsByLesson: Map<string, string>;
  /** Є провалена спроба, і тест ще не складено. */
  failedWithoutPass: Set<string>;
  cleared: Set<string>;
  locked: Set<string>;
};

type GateDb = Prisma.TransactionClient | PrismaService;

export function lessonOrder(left: GateLesson, right: GateLesson): number {
  return (
    left.chapterPosition - right.chapterPosition ||
    left.position - right.position ||
    left.id.localeCompare(right.id)
  );
}

/**
 * Перший опублікований урок відкритий.
 * Кожен наступний закритий, доки попередній не пройдено і, якщо в нього є
 * опублікований тест, цей тест не складено.
 */
export function lockedLessonIds(
  ordered: readonly GateLesson[],
  cleared: ReadonlySet<string>,
): Set<string> {
  const locked = new Set<string>();
  for (let index = 1; index < ordered.length; index += 1) {
    if (!cleared.has(ordered[index - 1].id)) {
      for (let rest = index; rest < ordered.length; rest += 1) {
        locked.add(ordered[rest].id);
      }
      break;
    }
  }
  return locked;
}

export async function loadLessonGate(
  db: GateDb,
  organizationId: string,
  courseId: string,
  studentId: string,
): Promise<LessonGate> {
  const lessons = await db.courseLesson.findMany({
    where: {
      courseId,
      publicationStatus: CourseLessonPublicationStatus.PUBLISHED,
    },
    select: {
      id: true,
      position: true,
      chapter: { select: { position: true } },
    },
  });
  const ordered = lessons
    .map((lesson) => ({
      id: lesson.id,
      position: lesson.position,
      chapterPosition: lesson.chapter.position,
    }))
    .sort(lessonOrder);
  const ids = ordered.map((lesson) => lesson.id);
  const completions =
    ids.length === 0
      ? []
      : await db.courseLessonCompletion.findMany({
          where: {
            organizationId,
            courseId,
            studentId,
            lessonId: { in: ids },
          },
          select: { lessonId: true },
        });
  const completed = new Set(completions.map((row) => row.lessonId));
  const tests =
    ids.length === 0
      ? []
      : await db.theoryTest.findMany({
          where: {
            organizationId,
            courseId,
            publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
            courseLessonId: { in: ids },
          },
          select: { id: true, courseLessonId: true },
        });
  const testsByLesson = new Map<string, string>();
  for (const test of tests) {
    if (test.courseLessonId) {
      testsByLesson.set(test.courseLessonId, test.id);
    }
  }
  const testIds = [...testsByLesson.values()];
  const attempts =
    testIds.length === 0
      ? []
      : await db.theoryTestAttempt.findMany({
          where: {
            organizationId,
            studentId,
            testId: { in: testIds },
            status: {
              in: [
                TheoryTestAttemptStatus.PASSED,
                TheoryTestAttemptStatus.FAILED,
              ],
            },
          },
          select: { testId: true, status: true },
        });
  const lessonByTest = new Map(
    [...testsByLesson.entries()].map(([lessonId, testId]) => [
      testId,
      lessonId,
    ]),
  );
  const passed = new Set<string>();
  const failedWithoutPass = new Set<string>();
  for (const attempt of attempts) {
    const lessonId = lessonByTest.get(attempt.testId);
    if (!lessonId) {
      continue;
    }
    if (attempt.status === TheoryTestAttemptStatus.PASSED) {
      passed.add(lessonId);
    }
  }
  for (const attempt of attempts) {
    const lessonId = lessonByTest.get(attempt.testId);
    if (
      lessonId &&
      attempt.status === TheoryTestAttemptStatus.FAILED &&
      !passed.has(lessonId)
    ) {
      failedWithoutPass.add(lessonId);
    }
  }
  const cleared = new Set<string>();
  for (const lesson of ordered) {
    const hasTest = testsByLesson.has(lesson.id);
    if (completed.has(lesson.id) && (!hasTest || passed.has(lesson.id))) {
      cleared.add(lesson.id);
    }
  }
  return {
    ordered,
    completed,
    passed,
    testsByLesson,
    failedWithoutPass,
    cleared,
    locked: lockedLessonIds(ordered, cleared),
  };
}
