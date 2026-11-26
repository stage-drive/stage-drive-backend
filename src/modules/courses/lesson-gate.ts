import {
  CourseLessonPublicationStatus,
  Prisma,
  TheoryTestAttemptStatus,
  TheoryTestPublicationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  NextAttemptBlockReason,
  nextAttemptAvailability,
} from '../tests/test-attempts.rules';

/** Скільки спроб має тест, прив’язаний до уроку. */
export const LESSON_TEST_ATTEMPTS = 3;

export const LESSON_RETRY_MESSAGE = 'Пройдіть урок ще раз.';

export const LESSON_LOCKED_MESSAGE =
  'Спершу завершіть попередній урок: складіть його тест або, якщо тесту немає, позначте урок пройденим.';

export type GateLesson = {
  id: string;
  position: number;
  chapterPosition: number;
};

/**
 * Стан тесту уроку для одного студента в поточному циклі спроб.
 * Лічильники рахують лише поточний цикл: після вичерпаних спроб і повторного проходження уроку
 * вони починаються з нуля, а історія попередніх циклів лишається в базі.
 */
export type LessonTestState = {
  testId: string;
  maxAttempts: number | null;
  /** Номер поточного циклу спроб, з 1. */
  cycle: number;
  /** Тест складено хоча б раз. Лише PASSED відкриває наступний урок. */
  passed: boolean;
  /** Слоти поточного циклу, що вже зайняті: витрачені спроби та відкрита. */
  attemptsUsed: number;
  /** Скільки спроб ще можна почати в поточному циклі. null — без ліміту. */
  attemptsLeft: number | null;
  openAttemptId: string | null;
  nextAttemptAvailable: boolean;
  unavailableReason: NextAttemptBlockReason | null;
  /** Усі спроби поточного циклу витрачено, тест не складено: треба пройти урок ще раз. */
  exhausted: boolean;
};

/**
 * Те, що клієнт бачить про тест уроку в прогресі й змісті курсу.
 * lockedNextUntilPassed: наступний урок закритий, доки тест не складено (PASSED).
 */
export type LessonTestProgress = {
  id: string;
  status: TheoryTestPublicationStatus;
  passed: boolean;
  attemptsUsed: number;
  attemptsLeft: number | null;
  maxAttempts: number | null;
  openAttemptId: string | null;
  nextAttemptAvailable: boolean;
  lockedNextUntilPassed: boolean;
};

export function toLessonTestProgress(
  state: LessonTestState,
): LessonTestProgress {
  return {
    id: state.testId,
    status: TheoryTestPublicationStatus.PUBLISHED,
    passed: state.passed,
    attemptsUsed: state.attemptsUsed,
    attemptsLeft: state.attemptsLeft,
    maxAttempts: state.maxAttempts,
    openAttemptId: state.openAttemptId,
    nextAttemptAvailable: state.nextAttemptAvailable,
    lockedNextUntilPassed: !state.passed,
  };
}

export type LessonGate = {
  ordered: GateLesson[];
  /** Уроки, позначені пройденими. Перегляд матеріалів не обов’язковий для уроку з тестом. */
  completed: Set<string>;
  passed: Set<string>;
  /** lessonId → id опублікованого тесту цього уроку. */
  testsByLesson: Map<string, string>;
  /** lessonId → стан опублікованого тесту цього уроку. */
  tests: Map<string, LessonTestState>;
  /** Уроки, де спроби поточного циклу вичерпано без складеного тесту. */
  exhausted: Set<string>;
  /**
   * Урок завершено. Є опублікований тест — завершує лише PASSED.
   * Немає тесту — досить позначки «пройдено». Так лишаються лише старі уроки:
   * новий урок без опублікованого тесту опублікувати не можна.
   */
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
 * Кожен наступний закритий, доки попередній не завершено: для уроку з опублікованим тестом
 * це складений тест, для уроку без тесту — позначка «пройдено».
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
  now: Date = new Date(),
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
          select: { lessonId: true, testCycle: true },
        });
  const completed = new Set(completions.map((row) => row.lessonId));
  const cycleByLesson = new Map(
    completions.map((row) => [row.lessonId, row.testCycle]),
  );
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
          select: { id: true, courseLessonId: true, maxAttempts: true },
        });
  const testsByLesson = new Map<string, string>();
  for (const test of tests) {
    if (test.courseLessonId) {
      testsByLesson.set(test.courseLessonId, test.id);
    }
  }
  const attempts =
    tests.length === 0
      ? []
      : await db.theoryTestAttempt.findMany({
          where: {
            organizationId,
            studentId,
            testId: { in: tests.map((test) => test.id) },
          },
          select: {
            id: true,
            testId: true,
            status: true,
            cycle: true,
            expiresAt: true,
          },
        });
  const attemptsByTest = new Map<string, typeof attempts>();
  for (const attempt of attempts) {
    const list = attemptsByTest.get(attempt.testId) ?? [];
    list.push(attempt);
    attemptsByTest.set(attempt.testId, list);
  }

  const testStates = new Map<string, LessonTestState>();
  const passed = new Set<string>();
  const exhausted = new Set<string>();
  for (const test of tests) {
    if (!test.courseLessonId) {
      continue;
    }
    const history = attemptsByTest.get(test.id) ?? [];
    const cycle = cycleByLesson.get(test.courseLessonId) ?? 1;
    const decision = nextAttemptAvailability(
      test.maxAttempts,
      history,
      now,
      cycle,
    );
    const hasPassed = history.some(
      (attempt) => attempt.status === TheoryTestAttemptStatus.PASSED,
    );
    const isExhausted =
      !hasPassed &&
      decision.unavailableReason === NextAttemptBlockReason.ATTEMPTS_EXHAUSTED;
    if (hasPassed) {
      passed.add(test.courseLessonId);
    }
    if (isExhausted) {
      exhausted.add(test.courseLessonId);
    }
    testStates.set(test.courseLessonId, {
      testId: test.id,
      maxAttempts: test.maxAttempts,
      cycle,
      passed: hasPassed,
      attemptsUsed: decision.attemptsStarted,
      attemptsLeft: decision.attemptsRemaining,
      openAttemptId: decision.openAttemptId,
      nextAttemptAvailable: decision.nextAttemptAvailable && !hasPassed,
      unavailableReason: hasPassed
        ? NextAttemptBlockReason.ALREADY_PASSED
        : decision.unavailableReason,
      exhausted: isExhausted,
    });
  }

  const cleared = new Set<string>();
  for (const lesson of ordered) {
    const hasTest = testsByLesson.has(lesson.id);
    if (hasTest ? passed.has(lesson.id) : completed.has(lesson.id)) {
      cleared.add(lesson.id);
    }
  }
  return {
    ordered,
    completed,
    passed,
    testsByLesson,
    tests: testStates,
    exhausted,
    cleared,
    locked: lockedLessonIds(ordered, cleared),
  };
}
