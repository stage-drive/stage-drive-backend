import { TheoryTestAttemptStatus, TheoryTestFormat } from '@prisma/client';
import {
  AttemptApiResult,
  AttemptApiStatus,
  DUPLICATE_QUESTION_MESSAGE,
  NextAttemptBlockReason,
  SINGLE_OPTION_MESSAGE,
  UNKNOWN_OPTION_MESSAGE,
  UNKNOWN_QUESTION_MESSAGE,
  attemptApiResult,
  attemptApiStatus,
  attemptDeadline,
  gradeAttempt,
  isAttemptExpired,
  nextAttemptAvailability,
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
  const visible = (index: number, type: TheoryTestFormat) => ({
    id: questions[index].id,
    type,
    options: questions[index].options.map((option) => ({ id: option.id })),
  });

  it('accepts one option for a single-choice question and several for multiple', () => {
    expect(
      selectionErrors(
        [visible(0, TheoryTestFormat.SINGLE_CHOICE)],
        [{ questionId: 'q1', optionIds: ['b'] }],
      ),
    ).toEqual([]);
    expect(
      selectionErrors(
        [visible(1, TheoryTestFormat.MULTIPLE_CHOICE)],
        [{ questionId: 'q2', optionIds: ['c', 'd'] }],
      ),
    ).toEqual([]);
  });

  it('rejects a second option on a single-choice or true/false question', () => {
    expect(
      selectionErrors(
        [visible(0, TheoryTestFormat.TRUE_FALSE)],
        [{ questionId: 'q1', optionIds: ['a', 'b'] }],
      ),
    ).toEqual([
      { field: 'answers[0].optionIds', message: SINGLE_OPTION_MESSAGE },
    ]);
  });

  it('applies the type of each question, not one type for the whole test', () => {
    const mixed = [
      visible(0, TheoryTestFormat.SINGLE_CHOICE),
      visible(1, TheoryTestFormat.MULTIPLE_CHOICE),
    ];

    expect(
      selectionErrors(mixed, [
        { questionId: 'q1', optionIds: ['a', 'b'] },
        { questionId: 'q2', optionIds: ['c', 'd'] },
      ]),
    ).toEqual([
      { field: 'answers[0].optionIds', message: SINGLE_OPTION_MESSAGE },
    ]);
  });

  it('rejects a question or option that is not part of the attempt', () => {
    expect(
      selectionErrors(
        [visible(0, TheoryTestFormat.SINGLE_CHOICE)],
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
    ).toEqual({
      score: 67,
      passed: true,
      correctCount: 2,
      totalQuestions: 3,
      earnedPoints: 2,
      maxPoints: 3,
    });
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
    ).toMatchObject({
      score: 67,
      passed: false,
      correctCount: 2,
      totalQuestions: 3,
    });
  });

  it('counts a missing question as wrong', () => {
    expect(
      gradeAttempt(questions, [{ questionId: 'q1', optionIds: ['b'] }], 50),
    ).toMatchObject({
      score: 33,
      passed: false,
      correctCount: 1,
      totalQuestions: 3,
    });
  });

  it('passes when the score is equal to the threshold', () => {
    expect(
      gradeAttempt(questions, [{ questionId: 'q1', optionIds: ['b'] }], 33),
    ).toMatchObject({ score: 33, passed: true });
  });

  it('scores an attempt without answers as zero', () => {
    expect(gradeAttempt(questions, [], 1)).toEqual({
      score: 0,
      passed: false,
      correctCount: 0,
      totalQuestions: 3,
      earnedPoints: 0,
      maxPoints: 3,
    });
  });
});

describe('attempt status for the API', () => {
  it('shows a graded attempt as COMPLETED with a separate result', () => {
    expect(attemptApiStatus(TheoryTestAttemptStatus.PASSED)).toBe(
      AttemptApiStatus.COMPLETED,
    );
    expect(attemptApiStatus(TheoryTestAttemptStatus.FAILED)).toBe(
      AttemptApiStatus.COMPLETED,
    );
    expect(attemptApiResult(TheoryTestAttemptStatus.PASSED)).toBe(
      AttemptApiResult.PASSED,
    );
    expect(attemptApiResult(TheoryTestAttemptStatus.FAILED)).toBe(
      AttemptApiResult.FAILED,
    );
  });

  it('gives no result to an open or expired attempt', () => {
    expect(attemptApiStatus(TheoryTestAttemptStatus.IN_PROGRESS)).toBe(
      AttemptApiStatus.IN_PROGRESS,
    );
    expect(attemptApiStatus(TheoryTestAttemptStatus.EXPIRED)).toBe(
      AttemptApiStatus.EXPIRED,
    );
    expect(attemptApiResult(TheoryTestAttemptStatus.IN_PROGRESS)).toBeNull();
    expect(attemptApiResult(TheoryTestAttemptStatus.EXPIRED)).toBeNull();
  });
});

describe('nextAttemptAvailability', () => {
  const now = new Date('2026-11-21T12:00:00.000Z');

  it('allows another attempt when the limit is not set and the test is not passed', () => {
    expect(
      nextAttemptAvailability(
        null,
        [
          {
            id: 'failed',
            status: TheoryTestAttemptStatus.FAILED,
            expiresAt: null,
          },
        ],
        now,
      ),
    ).toMatchObject({
      attemptsUsed: 1,
      attemptsRemaining: null,
      nextAttemptAvailable: true,
      unavailableReason: null,
    });
  });

  it('blocks a second start while one attempt is still open', () => {
    expect(
      nextAttemptAvailability(
        3,
        [
          {
            id: 'open',
            status: TheoryTestAttemptStatus.IN_PROGRESS,
            expiresAt: new Date('2026-11-21T12:20:00.000Z'),
          },
        ],
        now,
      ),
    ).toEqual({
      attemptsUsed: 0,
      attemptsStarted: 1,
      attemptsRemaining: 2,
      nextAttemptAvailable: false,
      unavailableReason: NextAttemptBlockReason.IN_PROGRESS,
      openAttemptId: 'open',
    });
  });

  it('counts an overdue open attempt as spent', () => {
    expect(
      nextAttemptAvailability(
        1,
        [
          {
            id: 'late',
            status: TheoryTestAttemptStatus.IN_PROGRESS,
            expiresAt: new Date('2026-11-21T11:00:00.000Z'),
          },
        ],
        now,
      ),
    ).toMatchObject({
      attemptsUsed: 1,
      attemptsRemaining: 0,
      nextAttemptAvailable: false,
      unavailableReason: NextAttemptBlockReason.ATTEMPTS_EXHAUSTED,
    });
  });

  it('stops retries after a pass even if attempts remain', () => {
    expect(
      nextAttemptAvailability(
        3,
        [
          {
            id: 'passed',
            status: TheoryTestAttemptStatus.PASSED,
            expiresAt: null,
          },
        ],
        now,
      ).unavailableReason,
    ).toBe(NextAttemptBlockReason.ALREADY_PASSED);
  });

  it('stops retries when every allowed attempt is spent', () => {
    expect(
      nextAttemptAvailability(
        2,
        [
          {
            id: 'one',
            status: TheoryTestAttemptStatus.FAILED,
            expiresAt: null,
          },
          {
            id: 'two',
            status: TheoryTestAttemptStatus.EXPIRED,
            expiresAt: null,
          },
        ],
        now,
      ),
    ).toMatchObject({
      attemptsUsed: 2,
      nextAttemptAvailable: false,
      unavailableReason: NextAttemptBlockReason.ATTEMPTS_EXHAUSTED,
    });
  });

  describe('cycles', () => {
    const history = [
      {
        id: 'c1-1',
        status: TheoryTestAttemptStatus.FAILED,
        expiresAt: null,
        cycle: 1,
      },
      {
        id: 'c1-2',
        status: TheoryTestAttemptStatus.FAILED,
        expiresAt: null,
        cycle: 1,
      },
      {
        id: 'c1-3',
        status: TheoryTestAttemptStatus.EXPIRED,
        expiresAt: null,
        cycle: 1,
      },
    ];

    it('is exhausted in the cycle where all attempts were spent', () => {
      expect(nextAttemptAvailability(3, history, now, 1)).toMatchObject({
        attemptsUsed: 3,
        attemptsStarted: 3,
        attemptsRemaining: 0,
        nextAttemptAvailable: false,
        unavailableReason: NextAttemptBlockReason.ATTEMPTS_EXHAUSTED,
      });
    });

    it('starts the next cycle from zero and keeps the old history out of the count', () => {
      expect(nextAttemptAvailability(3, history, now, 2)).toMatchObject({
        attemptsUsed: 0,
        attemptsStarted: 0,
        attemptsRemaining: 3,
        nextAttemptAvailable: true,
        unavailableReason: null,
      });
    });

    it('counts only attempts of the requested cycle', () => {
      const withNewCycle = [
        ...history,
        {
          id: 'c2-1',
          status: TheoryTestAttemptStatus.FAILED,
          expiresAt: null,
          cycle: 2,
        },
        {
          id: 'c2-2',
          status: TheoryTestAttemptStatus.IN_PROGRESS,
          expiresAt: new Date('2026-11-21T12:20:00.000Z'),
          cycle: 2,
        },
      ];

      expect(nextAttemptAvailability(3, withNewCycle, now, 2)).toMatchObject({
        attemptsUsed: 1,
        attemptsStarted: 2,
        attemptsRemaining: 1,
        unavailableReason: NextAttemptBlockReason.IN_PROGRESS,
        openAttemptId: 'c2-2',
      });
    });

    it('counts every attempt when no cycle is given', () => {
      expect(nextAttemptAvailability(3, history, now)).toMatchObject({
        attemptsUsed: 3,
        unavailableReason: NextAttemptBlockReason.ATTEMPTS_EXHAUSTED,
      });
    });
  });
});
