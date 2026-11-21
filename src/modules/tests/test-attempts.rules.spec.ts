import { TheoryTestFormat } from '@prisma/client';
import {
  DUPLICATE_QUESTION_MESSAGE,
  SINGLE_OPTION_MESSAGE,
  UNKNOWN_OPTION_MESSAGE,
  UNKNOWN_QUESTION_MESSAGE,
  attemptDeadline,
  gradeAttempt,
  isAttemptExpired,
  selectionErrors,
  shuffleInPlace,
} from './test-attempts.rules';

const questions = [
  {
    id: 'q1',
    options: [
      { id: 'a', isCorrect: false },
      { id: 'b', isCorrect: true },
    ],
  },
  {
    id: 'q2',
    options: [
      { id: 'c', isCorrect: true },
      { id: 'd', isCorrect: true },
      { id: 'e', isCorrect: false },
    ],
  },
  {
    id: 'q3',
    options: [
      { id: 'f', isCorrect: false },
      { id: 'g', isCorrect: true },
    ],
  },
];

describe('attempt deadline', () => {
  const startedAt = new Date('2026-11-21T12:00:00.000Z');

  it('adds the limit in minutes', () => {
    expect(attemptDeadline(startedAt, 20)).toEqual(
      new Date('2026-11-21T12:20:00.000Z'),
    );
  });

  it('has no deadline when the test does not limit time', () => {
    expect(attemptDeadline(startedAt, null)).toBeNull();
    expect(isAttemptExpired(null, new Date('2099-01-01T00:00:00.000Z'))).toBe(
      false,
    );
  });

  it('treats the deadline instant as already expired', () => {
    const expiresAt = new Date('2026-11-21T12:20:00.000Z');
    expect(
      isAttemptExpired(expiresAt, new Date('2026-11-21T12:19:59.999Z')),
    ).toBe(false);
    expect(isAttemptExpired(expiresAt, expiresAt)).toBe(true);
  });
});

describe('shuffleInPlace', () => {
  it('keeps every item and does not change the source array', () => {
    const source = ['a', 'b', 'c'];
    const shuffled = shuffleInPlace(source, () => 0);
    expect(shuffled).toEqual(['b', 'c', 'a']);
    expect(source).toEqual(['a', 'b', 'c']);
  });
});

describe('selectionErrors', () => {
  const visible = questions.map((question) => ({
    id: question.id,
    options: question.options.map((option) => ({ id: option.id })),
  }));

  it('accepts one option for a single-choice question and several for multiple', () => {
    expect(
      selectionErrors(
        TheoryTestFormat.SINGLE_CHOICE,
        [visible[0]],
        [{ questionId: 'q1', optionIds: ['b'] }],
      ),
    ).toEqual([]);
    expect(
      selectionErrors(
        TheoryTestFormat.MULTIPLE_CHOICE,
        [visible[1]],
        [{ questionId: 'q2', optionIds: ['c', 'd'] }],
      ),
    ).toEqual([]);
  });

  it('rejects a second option on a single-choice or true/false question', () => {
    expect(
      selectionErrors(
        TheoryTestFormat.TRUE_FALSE,
        [visible[0]],
        [{ questionId: 'q1', optionIds: ['a', 'b'] }],
      ),
    ).toEqual([
      { field: 'answers[0].optionIds', message: SINGLE_OPTION_MESSAGE },
    ]);
  });

  it('rejects a question or option that is not part of the attempt', () => {
    expect(
      selectionErrors(
        TheoryTestFormat.SINGLE_CHOICE,
        [visible[0]],
        [
          { questionId: 'other', optionIds: [] },
          { questionId: 'q1', optionIds: ['missing'] },
          { questionId: 'q1', optionIds: ['b'] },
        ],
      ),
    ).toEqual([
      { field: 'answers[0].questionId', message: UNKNOWN_QUESTION_MESSAGE },
      { field: 'answers[1].optionIds[0]', message: UNKNOWN_OPTION_MESSAGE },
      { field: 'answers[2].questionId', message: DUPLICATE_QUESTION_MESSAGE },
    ]);
  });
});

describe('gradeAttempt', () => {
  it('scores an exact match and rounds to the nearest percent', () => {
    expect(
      gradeAttempt(
        questions,
        [
          { questionId: 'q1', optionIds: ['b'] },
          { questionId: 'q2', optionIds: ['d', 'c'] },
        ],
        67,
      ),
    ).toEqual({ score: 67, passed: true });
  });

  it('fails when the score is below the threshold or a multiple-choice set is incomplete', () => {
    expect(
      gradeAttempt(
        questions,
        [
          { questionId: 'q1', optionIds: ['b'] },
          { questionId: 'q2', optionIds: ['c'] },
          { questionId: 'q3', optionIds: ['g'] },
        ],
        90,
      ),
    ).toEqual({ score: 67, passed: false });
  });

  it('counts a missing question as wrong', () => {
    expect(
      gradeAttempt(questions, [{ questionId: 'q1', optionIds: ['b'] }], 50),
    ).toEqual({ score: 33, passed: false });
  });
});
