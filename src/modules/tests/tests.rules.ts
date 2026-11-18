import { BadRequestException } from '@nestjs/common';
import { TheoryTestFormat } from '@prisma/client';

export type FieldError = {
  field: string;
  message: string;
};

export type CorrectnessOption = {
  isCorrect: boolean;
};

/**
 * Погоджені правила теоретичного тесту (DF-14).
 * Чернетка може бути неповною. Суперечливу правильну відповідь не зберігаємо ніколи:
 * SINGLE_CHOICE і TRUE_FALSE мають не більше однієї позначки isCorrect.
 * Перед публікацією кожне питання має відповідати формату тесту.
 */
export const PUBLISH_QUESTIONS_REQUIRED_MESSAGE =
  'Додайте хоча б одне питання перед публікацією.';
export const MIN_OPTIONS_MESSAGE = 'Додайте щонайменше два варіанти відповіді.';
export const SINGLE_CORRECT_MESSAGE =
  'Питання з однією відповіддю має мати рівно один правильний варіант.';
export const SINGLE_EXCLUSIVE_MESSAGE =
  'Питання з однією відповіддю може мати лише одну правильну відповідь.';
export const MULTIPLE_CORRECT_REQUIRED_MESSAGE =
  'Позначте хоча б один правильний варіант.';
export const MULTIPLE_INCORRECT_REQUIRED_MESSAGE =
  'Залиште хоча б один неправильний варіант.';
export const TRUE_FALSE_OPTIONS_MESSAGE =
  'Питання «Так/Ні» має містити рівно два варіанти.';
export const TRUE_FALSE_CORRECT_MESSAGE =
  'Питання «Так/Ні» має мати рівно одну правильну відповідь.';
export const TRUE_FALSE_EXCLUSIVE_MESSAGE =
  'Питання «Так/Ні» може мати лише одну правильну відповідь.';

export function isExclusiveFormat(format: TheoryTestFormat): boolean {
  return (
    format === TheoryTestFormat.SINGLE_CHOICE ||
    format === TheoryTestFormat.TRUE_FALSE
  );
}

export function questionRuleErrors(
  format: TheoryTestFormat,
  options: CorrectnessOption[],
  field = 'options',
): FieldError[] {
  const correct = options.filter((option) => option.isCorrect).length;
  if (format === TheoryTestFormat.TRUE_FALSE) {
    if (options.length !== 2) {
      return [{ field, message: TRUE_FALSE_OPTIONS_MESSAGE }];
    }
    if (correct !== 1) {
      return [{ field, message: TRUE_FALSE_CORRECT_MESSAGE }];
    }
    return [];
  }
  if (options.length < 2) {
    return [{ field, message: MIN_OPTIONS_MESSAGE }];
  }
  if (format === TheoryTestFormat.SINGLE_CHOICE && correct !== 1) {
    return [{ field, message: SINGLE_CORRECT_MESSAGE }];
  }
  if (format === TheoryTestFormat.MULTIPLE_CHOICE && correct < 1) {
    return [{ field, message: MULTIPLE_CORRECT_REQUIRED_MESSAGE }];
  }
  if (
    format === TheoryTestFormat.MULTIPLE_CHOICE &&
    correct === options.length
  ) {
    return [{ field, message: MULTIPLE_INCORRECT_REQUIRED_MESSAGE }];
  }
  return [];
}

/** Чернетка: відхиляє лише другу правильну відповідь у форматі з однією правильною. */
export function exclusiveCorrectErrors(
  format: TheoryTestFormat,
  options: CorrectnessOption[],
  field = 'options',
): FieldError[] {
  if (!isExclusiveFormat(format)) {
    return [];
  }
  const correct = options.filter((option) => option.isCorrect).length;
  if (correct <= 1) {
    return [];
  }
  return [
    {
      field,
      message:
        format === TheoryTestFormat.TRUE_FALSE
          ? TRUE_FALSE_EXCLUSIVE_MESSAGE
          : SINGLE_EXCLUSIVE_MESSAGE,
    },
  ];
}

export function publicationErrors(
  format: TheoryTestFormat,
  questions: Array<{ options: CorrectnessOption[] }>,
): FieldError[] {
  if (questions.length === 0) {
    return [
      { field: 'questions', message: PUBLISH_QUESTIONS_REQUIRED_MESSAGE },
    ];
  }
  return questions.flatMap((question, index) =>
    questionRuleErrors(format, question.options, `questions[${index}].options`),
  );
}

export function assertFieldErrors(errors: FieldError[]): void {
  if (errors.length > 0) {
    throw new BadRequestException({ statusCode: 400, errors });
  }
}
