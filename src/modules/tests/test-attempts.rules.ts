import { TheoryTestFormat } from '@prisma/client';
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

export function selectionErrors(
  format: TheoryTestFormat,
  questions: Array<{ id: string; options: Array<{ id: string }> }>,
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
    if (isExclusiveFormat(format) && answer.optionIds.length > 1) {
      errors.push({
        field: `${field}.optionIds`,
        message: SINGLE_OPTION_MESSAGE,
      });
    }
  });
  return errors;
}

/**
 * Питання зараховане, коли обраний набір варіантів збігається з правильним.
 * Пропущене питання — неправильне. Відсоток округлюється до цілого.
 */
export function gradeAttempt(
  questions: GradedQuestion[],
  answers: AnswerSelection[],
  passingScore: number,
): { score: number; passed: boolean } {
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
  return { score, passed: score >= passingScore };
}
