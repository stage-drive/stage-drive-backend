import { ConflictException } from '@nestjs/common';
import {
  DrivingLessonStatus,
  EnrollmentStatus,
  LessonStatus,
} from '@prisma/client';
import {
  LESSON_SCHEDULE_CONFLICT_MESSAGE,
  LessonConflict,
  candidateWindow,
  findPracticeConflicts,
  findTheoryConflicts,
  lessonSlot,
  overlaps,
  scheduleConflict,
  sortConflicts,
} from './schedule-conflicts';

const at = (iso: string) => new Date(iso);

describe('overlaps', () => {
  // 10:00–11:00 UTC
  const slot = lessonSlot(at('2026-11-03T10:00:00Z'), 60);

  it.each([
    ['ends exactly when the slot starts', '2026-11-03T09:00:00Z', 60, false],
    ['starts exactly when the slot ends', '2026-11-03T11:00:00Z', 60, false],
    ['overlaps the start by a minute', '2026-11-03T09:01:00Z', 60, true],
    ['overlaps the end by a minute', '2026-11-03T10:59:00Z', 60, true],
    ['sits inside the slot', '2026-11-03T10:15:00Z', 30, true],
    ['contains the slot', '2026-11-03T09:00:00Z', 180, true],
    ['matches the slot exactly', '2026-11-03T10:00:00Z', 60, true],
    ['is a day later', '2026-11-04T10:00:00Z', 60, false],
  ])('%s → %s', (_, start, durationMin, expected) => {
    expect(overlaps(slot, { scheduledAt: at(start), durationMin })).toBe(
      expected,
    );
  });
});

describe('candidateWindow', () => {
  it('reaches back by the maximum duration and stops at the slot end', () => {
    const slot = lessonSlot(at('2026-11-03T10:00:00Z'), 60);

    expect(candidateWindow(slot)).toEqual({
      gt: at('2026-11-03T06:00:00Z'),
      lt: at('2026-11-03T11:00:00Z'),
    });
  });
});

describe('sortConflicts', () => {
  const conflict = (
    resource: LessonConflict['resource'],
    scheduledAt: string,
    lessonId = 'lesson',
  ): LessonConflict => ({
    resource,
    resourceId: 'id',
    lessonType: 'PRACTICE',
    lessonId,
    scheduledAt: at(scheduledAt),
    endsAt: at(scheduledAt),
  });

  it('orders by resource, then start time, then lesson id', () => {
    const sorted = sortConflicts([
      conflict('STUDENT', '2026-11-03T08:00:00Z'),
      conflict('CAR', '2026-11-03T10:00:00Z'),
      conflict('INSTRUCTOR', '2026-11-03T10:00:00Z', 'b'),
      conflict('INSTRUCTOR', '2026-11-03T10:00:00Z', 'a'),
      conflict('INSTRUCTOR', '2026-11-03T09:00:00Z', 'z'),
      conflict('TEACHER', '2026-11-03T12:00:00Z'),
    ]);

    expect(sorted.map((c) => `${c.resource}:${c.lessonId}`)).toEqual([
      'TEACHER:lesson',
      'INSTRUCTOR:z',
      'INSTRUCTOR:a',
      'INSTRUCTOR:b',
      'CAR:lesson',
      'STUDENT:lesson',
    ]);
  });
});

describe('scheduleConflict', () => {
  it('builds a 409 body that lists every conflict', () => {
    const conflicts: LessonConflict[] = [
      {
        resource: 'CAR',
        resourceId: 'car-1',
        lessonType: 'PRACTICE',
        lessonId: 'lesson-2',
        scheduledAt: at('2026-11-03T08:00:00Z'),
        endsAt: at('2026-11-03T09:00:00Z'),
      },
    ];

    const error = scheduleConflict(conflicts);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: LESSON_SCHEDULE_CONFLICT_MESSAGE,
      conflicts,
    });
  });
});

describe('findPracticeConflicts', () => {
  const tx = {
    drivingLesson: { findMany: jest.fn() },
    lesson: { findMany: jest.fn() },
  };
  const input = {
    organizationId: 'org-1',
    lessonId: 'lesson-1',
    instructorId: 'instructor-1',
    carId: 'car-1',
    studentId: 'student-1',
    slot: lessonSlot(at('2026-11-03T10:00:00Z'), 60),
  };

  beforeEach(() => {
    tx.drivingLesson.findMany.mockReset().mockResolvedValue([]);
    tx.lesson.findMany.mockReset().mockResolvedValue([]);
  });

  it('queries only other SCHEDULED lessons of the organization in the window', async () => {
    await findPracticeConflicts(tx as never, input);

    const [practiceArgs] = tx.drivingLesson.findMany.mock.calls[0];
    expect(practiceArgs.where).toEqual({
      id: { not: 'lesson-1' },
      organizationId: 'org-1',
      status: DrivingLessonStatus.SCHEDULED,
      scheduledAt: candidateWindow(input.slot),
      OR: [
        { instructorId: 'instructor-1' },
        { carId: 'car-1' },
        { studentId: 'student-1' },
      ],
    });
    const [theoryArgs] = tx.lesson.findMany.mock.calls[0];
    expect(theoryArgs.where).toEqual({
      status: LessonStatus.SCHEDULED,
      scheduledAt: candidateWindow(input.slot),
      group: {
        organizationId: 'org-1',
        enrollments: {
          some: { studentId: 'student-1', status: EnrollmentStatus.ACTIVE },
        },
      },
    });
  });

  it('returns no conflicts when nothing overlaps', async () => {
    await expect(findPracticeConflicts(tx as never, input)).resolves.toEqual(
      [],
    );
  });

  it('ignores a candidate that ends before the slot starts', async () => {
    tx.drivingLesson.findMany.mockResolvedValue([
      {
        id: 'lesson-2',
        instructorId: 'instructor-1',
        carId: 'car-1',
        studentId: 'student-2',
        scheduledAt: at('2026-11-03T07:00:00Z'),
        durationMin: 60,
      },
    ]);

    await expect(findPracticeConflicts(tx as never, input)).resolves.toEqual(
      [],
    );
  });

  it('reports one entry per matching resource of an overlapping lesson', async () => {
    tx.drivingLesson.findMany.mockResolvedValue([
      {
        id: 'lesson-2',
        instructorId: 'instructor-1',
        carId: 'car-1',
        studentId: 'student-2',
        scheduledAt: at('2026-11-03T10:30:00Z'),
        durationMin: 60,
      },
    ]);

    const conflicts = await findPracticeConflicts(tx as never, input);

    expect(conflicts).toEqual([
      {
        resource: 'INSTRUCTOR',
        resourceId: 'instructor-1',
        lessonType: 'PRACTICE',
        lessonId: 'lesson-2',
        scheduledAt: at('2026-11-03T10:30:00Z'),
        endsAt: at('2026-11-03T11:30:00Z'),
      },
      {
        resource: 'CAR',
        resourceId: 'car-1',
        lessonType: 'PRACTICE',
        lessonId: 'lesson-2',
        scheduledAt: at('2026-11-03T10:30:00Z'),
        endsAt: at('2026-11-03T11:30:00Z'),
      },
    ]);
  });

  it('reports a theory lesson of the student group as a STUDENT conflict', async () => {
    tx.lesson.findMany.mockResolvedValue([
      {
        id: 'theory-1',
        scheduledAt: at('2026-11-03T09:30:00Z'),
        durationMin: 90,
      },
    ]);

    await expect(
      findPracticeConflicts(tx as never, input),
    ).resolves.toMatchObject([
      {
        resource: 'STUDENT',
        resourceId: 'student-1',
        lessonType: 'THEORY',
        lessonId: 'theory-1',
      },
    ]);
  });
});

describe('findTheoryConflicts', () => {
  const tx = {
    drivingLesson: { findMany: jest.fn() },
    lesson: { findMany: jest.fn() },
  };
  const input = {
    organizationId: 'org-1',
    lessonId: 'lesson-1',
    groupId: 'group-1',
    teacherId: 'teacher-1',
    slot: lessonSlot(at('2026-11-03T16:00:00Z'), 90),
  };

  beforeEach(() => {
    tx.drivingLesson.findMany.mockReset().mockResolvedValue([]);
    tx.lesson.findMany.mockReset().mockResolvedValue([]);
  });

  it('queries other lessons of the group or teacher and practice of group students', async () => {
    await findTheoryConflicts(tx as never, input);

    const [theoryArgs] = tx.lesson.findMany.mock.calls[0];
    expect(theoryArgs.where).toEqual({
      id: { not: 'lesson-1' },
      status: LessonStatus.SCHEDULED,
      scheduledAt: candidateWindow(input.slot),
      group: { organizationId: 'org-1' },
      OR: [{ groupId: 'group-1' }, { group: { teacherId: 'teacher-1' } }],
    });
    const [practiceArgs] = tx.drivingLesson.findMany.mock.calls[0];
    expect(practiceArgs.where).toEqual({
      organizationId: 'org-1',
      status: DrivingLessonStatus.SCHEDULED,
      scheduledAt: candidateWindow(input.slot),
      student: {
        enrollments: {
          some: { groupId: 'group-1', status: EnrollmentStatus.ACTIVE },
        },
      },
    });
  });

  it('reports GROUP and TEACHER for a lesson of the same group and teacher', async () => {
    tx.lesson.findMany.mockResolvedValue([
      {
        id: 'lesson-2',
        groupId: 'group-1',
        scheduledAt: at('2026-11-03T17:00:00Z'),
        durationMin: 90,
        group: { teacherId: 'teacher-1' },
      },
    ]);

    const conflicts = await findTheoryConflicts(tx as never, input);

    expect(conflicts.map((c) => [c.resource, c.resourceId])).toEqual([
      ['TEACHER', 'teacher-1'],
      ['GROUP', 'group-1'],
    ]);
  });

  it('reports only TEACHER for another group of the same teacher', async () => {
    tx.lesson.findMany.mockResolvedValue([
      {
        id: 'lesson-3',
        groupId: 'group-2',
        scheduledAt: at('2026-11-03T16:30:00Z'),
        durationMin: 90,
        group: { teacherId: 'teacher-1' },
      },
    ]);

    const conflicts = await findTheoryConflicts(tx as never, input);

    expect(conflicts.map((c) => c.resource)).toEqual(['TEACHER']);
  });

  it('reports practice of a group student as a STUDENT conflict', async () => {
    tx.drivingLesson.findMany.mockResolvedValue([
      {
        id: 'practice-1',
        studentId: 'student-7',
        scheduledAt: at('2026-11-03T17:00:00Z'),
        durationMin: 60,
      },
    ]);

    await expect(findTheoryConflicts(tx as never, input)).resolves.toEqual([
      {
        resource: 'STUDENT',
        resourceId: 'student-7',
        lessonType: 'PRACTICE',
        lessonId: 'practice-1',
        scheduledAt: at('2026-11-03T17:00:00Z'),
        endsAt: at('2026-11-03T18:00:00Z'),
      },
    ]);
  });
});
