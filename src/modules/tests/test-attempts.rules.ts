import { TheoryTestAttemptStatus, TheoryTestFormat } from '@prisma/client';
import { FieldError, isExclusiveFormat } from './tests.rules';

export const DUPLICATE_QUESTION_MESSAGE = 'Це питання вже є у відповідях.';
export const UNKNOWN_QUESTION_MESSAGE = 'Питання не входить до цієї спроби.';
export const UNKNOWN_OPTION_MESSAGE = 'Варіант не належить цьому питанню.';
export const DUPLICATE_OPTION_MESSAGE = 'Варіант повторено в цьому питанні.';
export const SINGLE_OPTION_MESSAGE =
  'Для цього питання можна обрати лише один варіант.';

export type GradedOption = {
  id: string;
  isCorrect: boolean;
};

export type GradedQuestion = {
  id: string;
  options: GradedOption[];
};

export type AnswerSelection = {
  questionId: string;
  optionIds: string[];
};

/**
 * Статус спроби в API. У базі PASSED і FAILED — окремі статуси, а клієнт бачить
 * завершену спробу (COMPLETED) і окреме поле result.
 */
export const AttemptApiStatus = {
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  EXPIRED: 'EXPIRED',
} as const;

export type AttemptApiStatus =
  (typeof AttemptApiStatus)[keyof typeof AttemptApiStatus];

export const AttemptApiResult = {
  PASSED: 'PASSED',
  FAILED: 'FAILED',
} as const;

export type AttemptApiResult =
  (typeof AttemptApiResult)[keyof typeof AttemptApiResult];

export function attemptApiStatus(
  status: TheoryTestAttemptStatus,
): AttemptApiStatus {
  switch (status) {
    case TheoryTestAttemptStatus.IN_PROGRESS:
      return AttemptApiStatus.IN_PROGRESS;
    case TheoryTestAttemptStatus.EXPIRED:
      return AttemptApiStatus.EXPIRED;
    default:
      return AttemptApiStatus.COMPLETED;
  }
}

/** PASSED або FAILED лише для перевіреної спроби. IN_PROGRESS і EXPIRED результату не мають. */
export function attemptApiResult(
  status: TheoryTestAttemptStatus,
): AttemptApiResult | null {
  if (status === TheoryTestAttemptStatus.PASSED) {
    return AttemptApiResult.PASSED;
  }
  if (status === TheoryTestAttemptStatus.FAILED) {
    return AttemptApiResult.FAILED;
  }
  return null;
}

/**
 * Дедлайн спроби. null — тест без ліміту, і час ніколи не «закінчується».
 * Момент expiresAt уже прострочений: студент не встигає submit в ту саму мілісекунду.
 */
export function attemptDeadline(
  startedAt: Date,
  timeLimitMinutes: number | null,
): Date | null {
  if (timeLimitMinutes === null) {
    return null;
  }
  return new Date(startedAt.getTime() + timeLimitMinutes * 60_000);
}

export function isAttemptExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && now.getTime() >= expiresAt.getTime();
}

/** Копія в порядку показу. Вхідний масив не змінюється. */
export function shuffleInPlace<T>(
  items: readonly T[],
  random: () => number = Math.random,
): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const current = copy[index];
    copy[index] = copy[swap];
    copy[swap] = current;
  }
  return copy;
}

/** Тип питання береться зі знімка питання: правила відповіді в кожного питання свої. */
export function selectionErrors(
  questions: Array<{
    id: string;
    type: TheoryTestFormat;
    options: Array<{ id: string }>;
  }>,
  answers: AnswerSelection[],
): FieldError[] {
  const errors: FieldError[] = [];
  const seenQuestions = new Set<string>();
  const questionsById = new Map(
    questions.map((question) => [question.id, question]),
  );
  answers.forEach((answer, index) => {
    const field = `answers[${index}]`;
    if (seenQuestions.has(answer.questionId)) {
      errors.push({
        field: `${field}.questionId`,
        message: DUPLICATE_QUESTION_MESSAGE,
      });
      return;
    }
    seenQuestions.add(answer.questionId);
    const question = questionsById.get(answer.questionId);
    if (!question) {
      errors.push({
        field: `${field}.questionId`,
        message: UNKNOWN_QUESTION_MESSAGE,
      });
      return;
    }
    const optionIds = new Set(question.options.map((option) => option.id));
    const selected = new Set<string>();
    answer.optionIds.forEach((optionId, optionIndex) => {
      if (!optionIds.has(optionId)) {
        errors.push({
          field: `${field}.optionIds[${optionIndex}]`,
          message: UNKNOWN_OPTION_MESSAGE,
        });
        return;
      }
      if (selected.has(optionId)) {
        errors.push({
          field: `${field}.optionIds[${optionIndex}]`,
          message: DUPLICATE_OPTION_MESSAGE,
        });
        return;
      }
      selected.add(optionId);
    });
    if (isExclusiveFormat(question.type) && answer.optionIds.length > 1) {
      errors.push({
        field: `${field}.optionIds`,
        message: SINGLE_OPTION_MESSAGE,
      });
    }
  });
  return errors;
}

export type AttemptGrade = {
  /** Відсоток правильних відповідей, ціле 0–100. */
  score: number;
  passed: boolean;
  /** Скільки питань відповідено точно. */
  correctCount: number;
  totalQuestions: number;
  /** Кожне питання варте одного бала: earnedPoints = correctCount. */
  earnedPoints: number;
  /** maxPoints = totalQuestions. */
  maxPoints: number;
};

/**
 * Питання зараховане, коли обраний набір варіантів збігається з правильним.
 * Пропущене питання — неправильне. Відсоток округлюється до цілого.
 * Усе рахує сервер: клієнт не передає ні бали, ні результат.
 */
export function gradeAttempt(
  questions: GradedQuestion[],
  answers: AnswerSelection[],
  passingScore: number,
): AttemptGrade {
  const selectedByQuestion = new Map(
    answers.map((answer) => [answer.questionId, answer.optionIds]),
  );
  let correct = 0;
  for (const question of questions) {
    const expected = question.options
      .filter((option) => option.isCorrect)
      .map((option) => option.id)
      .sort();
    const selected = [...(selectedByQuestion.get(question.id) ?? [])].sort();
    if (
      expected.length === selected.length &&
      expected.every((id, index) => id === selected[index])
    ) {
      correct += 1;
    }
  }
  const score =
    questions.length === 0 ? 0 : Math.round((correct / questions.length) * 100);
  return {
    score,
    passed: score >= passingScore,
    correctCount: correct,
    totalQuestions: questions.length,
    earnedPoints: correct,
    maxPoints: questions.length,
  };
}

/**
 * Чому наступну спробу почати не можна.
 * IN_PROGRESS — уже є відкрита і ще не прострочена.
 * ALREADY_PASSED — цей тест уже складено.
 * ATTEMPTS_EXHAUSTED — витрачено maxAttempts поточного циклу.
 * TEST_UNAVAILABLE — тест або курс зараз не можна проходити.
 */
export const NextAttemptBlockReason = {
  IN_PROGRESS: 'IN_PROGRESS',
  ALREADY_PASSED: 'ALREADY_PASSED',
  ATTEMPTS_EXHAUSTED: 'ATTEMPTS_EXHAUSTED',
  TEST_UNAVAILABLE: 'TEST_UNAVAILABLE',
} as const;

export type NextAttemptBlockReason =
  (typeof NextAttemptBlockReason)[keyof typeof NextAttemptBlockReason];

export type AttemptHistoryItem = {
  id: string;
  status: TheoryTestAttemptStatus;
  expiresAt: Date | null;
  /** Цикл спроби. Без нього спроба рахується в будь-якому циклі. */
  cycle?: number;
};

export type NextAttemptDecision = {
  /** Витрачено: PASSED, FAILED, EXPIRED і прострочена IN_PROGRESS. Відкрита спроба сюди не входить. */
  attemptsUsed: number;
  /** Витрачено плюс відкрита: стільки слотів поточного циклу вже зайнято. */
  attemptsStarted: number;
  /** Скільки спроб ще можна почати після зайнятих слотів. null — без ліміту. */
  attemptsRemaining: number | null;
  nextAttemptAvailable: boolean;
  unavailableReason: NextAttemptBlockReason | null;
  openAttemptId: string | null;
};

function isSpent(status: TheoryTestAttemptStatus): boolean {
  return (
    status === TheoryTestAttemptStatus.PASSED ||
    status === TheoryTestAttemptStatus.FAILED ||
    status === TheoryTestAttemptStatus.EXPIRED
  );
}

/**
 * Погоджені правила повторних спроб (DF-14).
 * Витрачена спроба — PASSED, FAILED або EXPIRED.
 * Прострочена IN_PROGRESS на момент перевірки теж витрачена: старт її закриє.
 * Відкрита і ще жива спроба займає слот і не дає почати другу.
 * Після PASSED нова спроба цього тесту недоступна, навіть якщо ліміт ще не вичерпано.
 * maxAttempts null — кількості немає, лишаються лише правила статусу.
 *
 * cycle обмежує підрахунок однією серією спроб: коли студент вичерпав ліміт і пройшов урок знову,
 * починається наступний цикл із нульовим лічильником, а історія попередніх циклів лишається.
 * Без cycle рахуються всі передані спроби.
 */
export function nextAttemptAvailability(
  maxAttempts: number | null,
  attempts: AttemptHistoryItem[],
  now: Date,
  cycle?: number,
): NextAttemptDecision {
  let open: AttemptHistoryItem | null = null;
  let passed = false;
  let used = 0;
  for (const attempt of attempts) {
    if (cycle !== undefined && (attempt.cycle ?? 1) !== cycle) {
      continue;
    }
    if (attempt.status === TheoryTestAttemptStatus.IN_PROGRESS) {
      if (isAttemptExpired(attempt.expiresAt, now)) {
        used += 1;
      } else if (!open) {
        open = attempt;
      }
      continue;
    }
    if (attempt.status === TheoryTestAttemptStatus.PASSED) {
      passed = true;
    }
    if (isSpent(attempt.status)) {
      used += 1;
    }
  }
  const attemptsStarted = used + (open ? 1 : 0);
  const attemptsRemaining =
    maxAttempts === null ? null : Math.max(0, maxAttempts - attemptsStarted);
  const base = {
    attemptsUsed: used,
    attemptsStarted,
    attemptsRemaining,
  };
  if (open) {
    return {
      ...base,
      nextAttemptAvailable: false,
      unavailableReason: NextAttemptBlockReason.IN_PROGRESS,
      openAttemptId: open.id,
    };
  }
  if (passed) {
    return {
      ...base,
      nextAttemptAvailable: false,
      unavailableReason: NextAttemptBlockReason.ALREADY_PASSED,
      openAttemptId: null,
    };
  }
  if (maxAttempts !== null && used >= maxAttempts) {
    return {
      ...base,
      nextAttemptAvailable: false,
      unavailableReason: NextAttemptBlockReason.ATTEMPTS_EXHAUSTED,
      openAttemptId: null,
    };
  }
  return {
    ...base,
    nextAttemptAvailable: true,
    unavailableReason: null,
    openAttemptId: null,
  };
}
