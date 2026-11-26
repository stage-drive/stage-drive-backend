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
 * Погоджені правила теоретичного тесту (DF-14, UC-003).
 * Чернетка може бути неповною. Суперечливу правильну відповідь не зберігаємо ніколи:
 * SINGLE_CHOICE і TRUE_FALSE мають не більше однієї позначки isCorrect.
 * Перед публікацією тест має назву, урок, поріг і ліміт спроб, а кожне питання відповідає своєму типу.
 */
export const PUBLISH_NAME_REQUIRED_MESSAGE =
  'Вкажіть назву тесту перед публікацією.';
export const PUBLISH_LESSON_REQUIRED_MESSAGE =
  'Прив’яжіть тест до уроку перед публікацією.';
export const PUBLISH_PASSING_SCORE_MESSAGE =
  'passingScore має бути від 1 до 100.';
export const PUBLISH_MAX_ATTEMPTS_MESSAGE =
  'maxAttempts має бути більшим за 0.';
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

/** Тип питання (TheoryQuestion.type), де відповідь лише одна. */
export function isExclusiveFormat(type: TheoryTestFormat): boolean {
  return (
    type === TheoryTestFormat.SINGLE_CHOICE ||
    type === TheoryTestFormat.TRUE_FALSE
  );
}

export function questionRuleErrors(
  type: TheoryTestFormat,
  options: CorrectnessOption[],
  field = 'options',
): FieldError[] {
  const correct = options.filter((option) => option.isCorrect).length;
  if (type === TheoryTestFormat.TRUE_FALSE) {
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
  if (type === TheoryTestFormat.SINGLE_CHOICE && correct !== 1) {
    return [{ field, message: SINGLE_CORRECT_MESSAGE }];
  }
  if (type === TheoryTestFormat.MULTIPLE_CHOICE && correct < 1) {
    return [{ field, message: MULTIPLE_CORRECT_REQUIRED_MESSAGE }];
  }
  if (type === TheoryTestFormat.MULTIPLE_CHOICE && correct === options.length) {
    return [{ field, message: MULTIPLE_INCORRECT_REQUIRED_MESSAGE }];
  }
  return [];
}

/** Чернетка: відхиляє лише другу правильну відповідь у питанні з однією правильною. */
export function exclusiveCorrectErrors(
  type: TheoryTestFormat,
  options: CorrectnessOption[],
  field = 'options',
): FieldError[] {
  if (!isExclusiveFormat(type)) {
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
        type === TheoryTestFormat.TRUE_FALSE
          ? TRUE_FALSE_EXCLUSIVE_MESSAGE
          : SINGLE_EXCLUSIVE_MESSAGE,
    },
  ];
}

export type PublicationTest = {
  name: string;
  courseLessonId: string | null;
  passingScore: number;
  maxAttempts: number | null;
};

/**
 * Поля самого тесту перед публікацією (UC-003): назва, урок, поріг складання,
 * ліміт спроб більший за нуль. Помилки йдуть у тому ж форматі, що й помилки валідації тіла.
 */
export function testPublicationErrors(test: PublicationTest): FieldError[] {
  const errors: FieldError[] = [];
  if (test.name.trim().length === 0) {
    errors.push({ field: 'name', message: PUBLISH_NAME_REQUIRED_MESSAGE });
  }
  if (test.courseLessonId === null) {
    errors.push({
      field: 'lessonId',
      message: PUBLISH_LESSON_REQUIRED_MESSAGE,
    });
  }
  if (
    !Number.isInteger(test.passingScore) ||
    test.passingScore < 1 ||
    test.passingScore > 100
  ) {
    errors.push({
      field: 'passingScore',
      message: PUBLISH_PASSING_SCORE_MESSAGE,
    });
  }
  if (
    test.maxAttempts === null ||
    !Number.isInteger(test.maxAttempts) ||
    test.maxAttempts < 1
  ) {
    errors.push({
      field: 'maxAttempts',
      message: PUBLISH_MAX_ATTEMPTS_MESSAGE,
    });
  }
  return errors;
}

/** Питання перед публікацією: хоча б одне, і кожне відповідає своєму типу. */
export function publicationErrors(
  questions: Array<{ type: TheoryTestFormat; options: CorrectnessOption[] }>,
): FieldError[] {
  if (questions.length === 0) {
    return [
      { field: 'questions', message: PUBLISH_QUESTIONS_REQUIRED_MESSAGE },
    ];
  }
  return questions.flatMap((question, index) =>
    questionRuleErrors(
      question.type,
      question.options,
      `questions[${index}].options`,
    ),
  );
}

export function assertFieldErrors(errors: FieldError[]): void {
  if (errors.length > 0) {
    throw new BadRequestException({ statusCode: 400, errors });
  }
}
