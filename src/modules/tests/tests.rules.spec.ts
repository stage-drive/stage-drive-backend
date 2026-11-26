import { BadRequestException } from '@nestjs/common';
import { TheoryTestFormat } from '@prisma/client';
import {
  exclusiveCorrectErrors,
  MIN_OPTIONS_MESSAGE,
  MULTIPLE_CORRECT_REQUIRED_MESSAGE,
  MULTIPLE_INCORRECT_REQUIRED_MESSAGE,
  publicationErrors,
  PUBLISH_LESSON_REQUIRED_MESSAGE,
  PUBLISH_MAX_ATTEMPTS_MESSAGE,
  PUBLISH_NAME_REQUIRED_MESSAGE,
  PUBLISH_PASSING_SCORE_MESSAGE,
  PUBLISH_QUESTIONS_REQUIRED_MESSAGE,
  questionRuleErrors,
  SINGLE_CORRECT_MESSAGE,
  SINGLE_EXCLUSIVE_MESSAGE,
  testPublicationErrors,
  TRUE_FALSE_CORRECT_MESSAGE,
  TRUE_FALSE_EXCLUSIVE_MESSAGE,
  TRUE_FALSE_OPTIONS_MESSAGE,
} from './tests.rules';

const correct = { isCorrect: true };
const wrong = { isCorrect: false };

describe('question rules', () => {
  it('accepts a single-choice question with one correct option', () => {
    expect(
      questionRuleErrors(TheoryTestFormat.SINGLE_CHOICE, [wrong, correct]),
    ).toEqual([]);
  });

  it('rejects a single-choice question without exactly one correct option', () => {
    expect(
      questionRuleErrors(TheoryTestFormat.SINGLE_CHOICE, [wrong, wrong]),
    ).toEqual([{ field: 'options', message: SINGLE_CORRECT_MESSAGE }]);
    expect(
      questionRuleErrors(TheoryTestFormat.SINGLE_CHOICE, [correct]),
    ).toEqual([{ field: 'options', message: MIN_OPTIONS_MESSAGE }]);
  });

  it('rejects multiple-choice without a wrong option or without a correct one', () => {
    expect(
      questionRuleErrors(TheoryTestFormat.MULTIPLE_CHOICE, [wrong, wrong]),
    ).toEqual([
      { field: 'options', message: MULTIPLE_CORRECT_REQUIRED_MESSAGE },
    ]);
    expect(
      questionRuleErrors(TheoryTestFormat.MULTIPLE_CHOICE, [correct, correct]),
    ).toEqual([
      { field: 'options', message: MULTIPLE_INCORRECT_REQUIRED_MESSAGE },
    ]);
  });

  it('accepts multiple-choice with both correct and incorrect options', () => {
    expect(
      questionRuleErrors(TheoryTestFormat.MULTIPLE_CHOICE, [
        correct,
        correct,
        wrong,
      ]),
    ).toEqual([]);
  });

  it('requires exactly two options and one correct answer for true/false', () => {
    expect(
      questionRuleErrors(TheoryTestFormat.TRUE_FALSE, [correct, wrong, wrong]),
    ).toEqual([{ field: 'options', message: TRUE_FALSE_OPTIONS_MESSAGE }]);
    expect(
      questionRuleErrors(TheoryTestFormat.TRUE_FALSE, [wrong, wrong]),
    ).toEqual([{ field: 'options', message: TRUE_FALSE_CORRECT_MESSAGE }]);
    expect(
      questionRuleErrors(TheoryTestFormat.TRUE_FALSE, [correct, wrong]),
    ).toEqual([]);
  });

  it('rejects a second correct answer in an exclusive format', () => {
    expect(
      exclusiveCorrectErrors(TheoryTestFormat.SINGLE_CHOICE, [
        correct,
        correct,
      ]),
    ).toEqual([{ field: 'options', message: SINGLE_EXCLUSIVE_MESSAGE }]);
    expect(
      exclusiveCorrectErrors(TheoryTestFormat.TRUE_FALSE, [correct, correct]),
    ).toEqual([{ field: 'options', message: TRUE_FALSE_EXCLUSIVE_MESSAGE }]);
    expect(
      exclusiveCorrectErrors(TheoryTestFormat.MULTIPLE_CHOICE, [
        correct,
        correct,
      ]),
    ).toEqual([]);
  });
});

describe('publication rules', () => {
  it('rejects a test without questions', () => {
    expect(publicationErrors([])).toEqual([
      { field: 'questions', message: PUBLISH_QUESTIONS_REQUIRED_MESSAGE },
    ]);
  });

  it('names every question that does not match its own type', () => {
    expect(
      publicationErrors([
        { type: TheoryTestFormat.SINGLE_CHOICE, options: [wrong, wrong] },
        { type: TheoryTestFormat.SINGLE_CHOICE, options: [correct, wrong] },
      ]),
    ).toEqual([
      { field: 'questions[0].options', message: SINGLE_CORRECT_MESSAGE },
    ]);
  });

  it('checks each question against its own type in a mixed test', () => {
    expect(
      publicationErrors([
        { type: TheoryTestFormat.SINGLE_CHOICE, options: [correct, wrong] },
        {
          type: TheoryTestFormat.MULTIPLE_CHOICE,
          options: [correct, correct, wrong],
        },
        { type: TheoryTestFormat.TRUE_FALSE, options: [correct, wrong, wrong] },
      ]),
    ).toEqual([
      { field: 'questions[2].options', message: TRUE_FALSE_OPTIONS_MESSAGE },
    ]);
  });

  it('throws field errors', () => {
    expect(() => {
      throw new BadRequestException({
        statusCode: 400,
        errors: publicationErrors([]),
      });
    }).toThrow(BadRequestException);
  });
});

describe('test publication rules (UC-003)', () => {
  const complete = {
    name: 'Тест уроку',
    courseLessonId: 'lesson-1',
    passingScore: 80,
    maxAttempts: 3,
  };

  it('accepts a test with a name, lesson, threshold and attempt limit', () => {
    expect(testPublicationErrors(complete)).toEqual([]);
  });

  it('requires a lesson', () => {
    expect(
      testPublicationErrors({ ...complete, courseLessonId: null }),
    ).toEqual([
      { field: 'lessonId', message: PUBLISH_LESSON_REQUIRED_MESSAGE },
    ]);
  });

  it('requires a non-blank name', () => {
    expect(testPublicationErrors({ ...complete, name: '   ' })).toEqual([
      { field: 'name', message: PUBLISH_NAME_REQUIRED_MESSAGE },
    ]);
  });

  it.each([0, 101, -5, 70.5])(
    'rejects passingScore %p outside 1..100',
    (passingScore) => {
      expect(testPublicationErrors({ ...complete, passingScore })).toEqual([
        { field: 'passingScore', message: PUBLISH_PASSING_SCORE_MESSAGE },
      ]);
    },
  );

  it.each([null, 0, -1])('rejects maxAttempts %p', (maxAttempts) => {
    expect(testPublicationErrors({ ...complete, maxAttempts })).toEqual([
      { field: 'maxAttempts', message: PUBLISH_MAX_ATTEMPTS_MESSAGE },
    ]);
  });

  it('reports every problem at once', () => {
    expect(
      testPublicationErrors({
        name: '',
        courseLessonId: null,
        passingScore: 0,
        maxAttempts: null,
      }).map((error) => error.field),
    ).toEqual(['name', 'lessonId', 'passingScore', 'maxAttempts']);
  });
});
