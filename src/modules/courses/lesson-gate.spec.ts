import {
  CourseLessonPublicationStatus,
  TheoryTestAttemptStatus,
  TheoryTestPublicationStatus,
} from '@prisma/client';
import { NextAttemptBlockReason } from '../tests/test-attempts.rules';
import { loadLessonGate, lockedLessonIds } from './lesson-gate';
import type { PrismaService } from '../../prisma/prisma.service';

const lesson = (id: string, chapterPosition: number, position: number) => ({
  id,
  chapterPosition,
  position,
});

describe('lockedLessonIds', () => {
  const ordered = [lesson('a', 1, 1), lesson('b', 1, 2), lesson('c', 2, 1)];

  it('leaves the first lesson open and locks the rest until it is cleared', () => {
    expect([...lockedLessonIds(ordered, new Set())]).toEqual(['b', 'c']);
  });

  it('opens the next lesson only after the previous one is cleared', () => {
    expect([...lockedLessonIds(ordered, new Set(['a']))]).toEqual(['c']);
    expect([...lockedLessonIds(ordered, new Set(['a', 'b']))]).toEqual([]);
  });

  it('does not open a later lesson when an earlier one is still closed', () => {
    expect([...lockedLessonIds(ordered, new Set(['b']))]).toEqual(['b', 'c']);
  });
});

describe('loadLessonGate', () => {
  const now = new Date('2026-11-25T12:00:00.000Z');

  type Attempt = {
    id?: string;
    testId: string;
    status: TheoryTestAttemptStatus;
    cycle?: number;
    expiresAt?: Date | null;
  };

  function gateDb(options: {
    lessons?: string[];
    completed?: Array<{ lessonId: string; testCycle?: number }>;
    tests?: Array<{
      id: string;
      lessonId: string;
      maxAttempts?: number | null;
    }>;
    attempts?: Attempt[];
  }) {
    const lessonIds = options.lessons ?? ['lesson-1', 'lesson-2'];
    const db = {
      courseLesson: {
        findMany: jest.fn().mockResolvedValue(
          lessonIds.map((id, index) => ({
            id,
            position: index + 1,
            chapter: { position: 1 },
          })),
        ),
      },
      courseLessonCompletion: {
        findMany: jest.fn().mockResolvedValue(
          (options.completed ?? []).map((row) => ({
            lessonId: row.lessonId,
            testCycle: row.testCycle ?? 1,
          })),
        ),
      },
      theoryTest: {
        findMany: jest.fn().mockResolvedValue(
          (options.tests ?? []).map((test) => ({
            id: test.id,
            courseLessonId: test.lessonId,
            maxAttempts: test.maxAttempts === undefined ? 3 : test.maxAttempts,
          })),
        ),
      },
      theoryTestAttempt: {
        findMany: jest.fn().mockResolvedValue(
          (options.attempts ?? []).map((attempt, index) => ({
            id: attempt.id ?? `attempt-${index}`,
            testId: attempt.testId,
            status: attempt.status,
            cycle: attempt.cycle ?? 1,
            expiresAt: attempt.expiresAt ?? null,
          })),
        ),
      },
    };
    return db;
  }

  const load = (db: ReturnType<typeof gateDb>) =>
    loadLessonGate(
      db as unknown as PrismaService,
      'org-1',
      'course-1',
      'student-1',
      now,
    );

  const failed = (testId: string, cycle = 1): Attempt => ({
    testId,
    status: TheoryTestAttemptStatus.FAILED,
    cycle,
  });

  it('only counts published lessons and published tests', async () => {
    const db = gateDb({ tests: [{ id: 'test-1', lessonId: 'lesson-1' }] });

    await load(db);

    expect(db.courseLesson.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          courseId: 'course-1',
          publicationStatus: CourseLessonPublicationStatus.PUBLISHED,
        },
      }),
    );
    expect(db.theoryTest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
        }),
      }),
    );
  });

  it('clears a lesson without a published test once it is marked completed', async () => {
    const gate = await load(gateDb({ completed: [{ lessonId: 'lesson-1' }] }));

    expect([...gate.cleared]).toEqual(['lesson-1']);
    expect([...gate.locked]).toEqual([]);
    expect(gate.tests.size).toBe(0);
  });

  it('keeps the next lesson locked while the lesson test is not passed, even if the lesson is completed', async () => {
    const gate = await load(
      gateDb({
        completed: [{ lessonId: 'lesson-1' }],
        tests: [{ id: 'test-1', lessonId: 'lesson-1' }],
        attempts: [failed('test-1')],
      }),
    );

    expect([...gate.cleared]).toEqual([]);
    expect([...gate.locked]).toEqual(['lesson-2']);
    expect(gate.tests.get('lesson-1')).toMatchObject({
      passed: false,
      attemptsUsed: 1,
      attemptsLeft: 2,
      exhausted: false,
      nextAttemptAvailable: true,
    });
  });

  it('opens the next lesson after a PASSED test without requiring a view mark', async () => {
    const gate = await load(
      gateDb({
        tests: [{ id: 'test-1', lessonId: 'lesson-1' }],
        attempts: [
          failed('test-1'),
          { testId: 'test-1', status: TheoryTestAttemptStatus.PASSED },
        ],
      }),
    );

    expect([...gate.cleared]).toEqual(['lesson-1']);
    expect([...gate.passed]).toEqual(['lesson-1']);
    expect([...gate.locked]).toEqual([]);
    expect(gate.tests.get('lesson-1')).toMatchObject({
      passed: true,
      nextAttemptAvailable: false,
      unavailableReason: NextAttemptBlockReason.ALREADY_PASSED,
    });
  });

  it('marks a lesson as exhausted after every attempt of the cycle failed', async () => {
    const gate = await load(
      gateDb({
        completed: [{ lessonId: 'lesson-1' }],
        tests: [{ id: 'test-1', lessonId: 'lesson-1' }],
        attempts: [failed('test-1'), failed('test-1'), failed('test-1')],
      }),
    );

    expect([...gate.exhausted]).toEqual(['lesson-1']);
    expect(gate.tests.get('lesson-1')).toMatchObject({
      attemptsUsed: 3,
      attemptsLeft: 0,
      exhausted: true,
      nextAttemptAvailable: false,
      unavailableReason: NextAttemptBlockReason.ATTEMPTS_EXHAUSTED,
    });
    expect([...gate.locked]).toEqual(['lesson-2']);
  });

  it('gives three new attempts in the next cycle and keeps the old history', async () => {
    const gate = await load(
      gateDb({
        completed: [{ lessonId: 'lesson-1', testCycle: 2 }],
        tests: [{ id: 'test-1', lessonId: 'lesson-1' }],
        attempts: [
          failed('test-1', 1),
          failed('test-1', 1),
          failed('test-1', 1),
        ],
      }),
    );

    expect(gate.exhausted.size).toBe(0);
    expect(gate.tests.get('lesson-1')).toMatchObject({
      cycle: 2,
      attemptsUsed: 0,
      attemptsLeft: 3,
      exhausted: false,
      nextAttemptAvailable: true,
    });
  });

  it('counts the open attempt as a used slot', async () => {
    const gate = await load(
      gateDb({
        tests: [{ id: 'test-1', lessonId: 'lesson-1' }],
        attempts: [
          failed('test-1'),
          {
            id: 'open-1',
            testId: 'test-1',
            status: TheoryTestAttemptStatus.IN_PROGRESS,
            expiresAt: new Date('2026-11-25T12:30:00.000Z'),
          },
        ],
      }),
    );

    expect(gate.tests.get('lesson-1')).toMatchObject({
      attemptsUsed: 2,
      attemptsLeft: 1,
      openAttemptId: 'open-1',
      nextAttemptAvailable: false,
      unavailableReason: NextAttemptBlockReason.IN_PROGRESS,
    });
  });

  it('counts an open attempt past its deadline as spent', async () => {
    const gate = await load(
      gateDb({
        tests: [{ id: 'test-1', lessonId: 'lesson-1' }],
        attempts: [
          {
            testId: 'test-1',
            status: TheoryTestAttemptStatus.IN_PROGRESS,
            expiresAt: new Date('2026-11-25T11:00:00.000Z'),
          },
        ],
      }),
    );

    expect(gate.tests.get('lesson-1')).toMatchObject({
      attemptsUsed: 1,
      attemptsLeft: 2,
      openAttemptId: null,
      nextAttemptAvailable: true,
    });
  });

  it('does not limit attempts when the test has no maxAttempts', async () => {
    const gate = await load(
      gateDb({
        tests: [{ id: 'test-1', lessonId: 'lesson-1', maxAttempts: null }],
        attempts: [failed('test-1'), failed('test-1'), failed('test-1')],
      }),
    );

    expect(gate.tests.get('lesson-1')).toMatchObject({
      attemptsLeft: null,
      exhausted: false,
      nextAttemptAvailable: true,
    });
  });
});
