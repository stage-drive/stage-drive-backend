import { BadRequestException } from '@nestjs/common';
import { TheoryTestFormat } from '@prisma/client';
import {
  exclusiveCorrectErrors,
  MIN_OPTIONS_MESSAGE,
  MULTIPLE_CORRECT_REQUIRED_MESSAGE,
  MULTIPLE_INCORRECT_REQUIRED_MESSAGE,
  publicationErrors,
  PUBLISH_QUESTIONS_REQUIRED_MESSAGE,
  questionRuleErrors,
  SINGLE_CORRECT_MESSAGE,
  SINGLE_EXCLUSIVE_MESSAGE,
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
    expect(publicationErrors(TheoryTestFormat.SINGLE_CHOICE, [])).toEqual([
      { field: 'questions', message: PUBLISH_QUESTIONS_REQUIRED_MESSAGE },
    ]);
  });

  it('names every question that does not match the format', () => {
    expect(
      publicationErrors(TheoryTestFormat.SINGLE_CHOICE, [
        { options: [wrong, wrong] },
        { options: [correct, wrong] },
      ]),
    ).toEqual([
      { field: 'questions[0].options', message: SINGLE_CORRECT_MESSAGE },
    ]);
  });

  it('throws field errors', () => {
    expect(() => {
      throw new BadRequestException({
        statusCode: 400,
        errors: publicationErrors(TheoryTestFormat.SINGLE_CHOICE, []),
      });
    }).toThrow(BadRequestException);
  });
});
