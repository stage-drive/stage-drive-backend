import { ConflictException } from '@nestjs/common';
import { EnrollmentStatus, LessonStatus } from '@prisma/client';
import {
  LESSON_SCHEDULE_CONFLICT_MESSAGE,
  LessonConflict,
  SlotBlocker,
  candidateWindow,
  findPracticeConflicts,
  findSlotConflicts,
  findStudentSlotBlockers,
  findTheoryConflicts,
  isSlotFree,
  lessonSlot,
  overlaps,
  scheduleConflict,
  sortConflicts,
  spanOf,
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
      status: LessonStatus.SCHEDULED,
      scheduledAt: candidateWindow(input.slot),
      OR: [
        { instructorId: 'instructor-1' },
        { carId: 'car-1' },
        { studentId: 'student-1' },
      ],
    });
    const [theoryArgs] = tx.lesson.findMany.mock.calls[0];
    expect(theoryArgs.where).toEqual({
      organizationId: 'org-1',
      status: LessonStatus.SCHEDULED,
      scheduledAt: candidateWindow(input.slot),
      group: {
        enrollments: {
          some: { studentId: 'student-1', status: EnrollmentStatus.ACTIVE },
        },
      },
    });
  });

  it('excludes nothing for a new lesson', async () => {
    await findPracticeConflicts(tx as never, { ...input, lessonId: null });

    const [practiceArgs] = tx.drivingLesson.findMany.mock.calls[0];
    expect(practiceArgs.where).not.toHaveProperty('id');
    expect(practiceArgs.where).toMatchObject({
      organizationId: 'org-1',
      status: LessonStatus.SCHEDULED,
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
      organizationId: 'org-1',
      status: LessonStatus.SCHEDULED,
      scheduledAt: candidateWindow(input.slot),
      OR: [{ groupId: 'group-1' }, { group: { teacherId: 'teacher-1' } }],
    });
    const [practiceArgs] = tx.drivingLesson.findMany.mock.calls[0];
    expect(practiceArgs.where).toEqual({
      organizationId: 'org-1',
      status: LessonStatus.SCHEDULED,
      scheduledAt: candidateWindow(input.slot),
      student: {
        enrollments: {
          some: { groupId: 'group-1', status: EnrollmentStatus.ACTIVE },
        },
      },
    });
  });

  it('excludes nothing for a new lesson', async () => {
    await findTheoryConflicts(tx as never, { ...input, lessonId: null });

    const [theoryArgs] = tx.lesson.findMany.mock.calls[0];
    expect(theoryArgs.where).not.toHaveProperty('id');
    expect(theoryArgs.where).toMatchObject({
      organizationId: 'org-1',
      status: LessonStatus.SCHEDULED,
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

describe('findSlotConflicts', () => {
  const tx = {
    practiceSlot: { findMany: jest.fn() },
    drivingLesson: { findMany: jest.fn() },
  };
  // 10:00–11:00 UTC
  const input = {
    organizationId: 'org-1',
    slotId: 'slot-1',
    instructorId: 'instructor-1',
    carId: 'car-1',
    interval: lessonSlot(at('2026-11-03T10:00:00Z'), 60),
  };
  const row = (overrides: object) => ({
    id: 'row-1',
    instructorId: 'instructor-2',
    carId: 'car-2',
    scheduledAt: at('2026-11-03T10:30:00Z'),
    durationMin: 60,
    ...overrides,
  });

  beforeEach(() => {
    tx.practiceSlot.findMany.mockReset().mockResolvedValue([]);
    tx.drivingLesson.findMany.mockReset().mockResolvedValue([]);
  });

  it('queries other slots and SCHEDULED lessons of the instructor or car in the window', async () => {
    await findSlotConflicts(tx as never, input);

    const [slotArgs] = tx.practiceSlot.findMany.mock.calls[0];
    expect(slotArgs.where).toEqual({
      id: { not: 'slot-1' },
      organizationId: 'org-1',
      scheduledAt: candidateWindow(input.interval),
      OR: [{ instructorId: 'instructor-1' }, { carId: 'car-1' }],
    });
    const [lessonArgs] = tx.drivingLesson.findMany.mock.calls[0];
    expect(lessonArgs.where).toEqual({
      organizationId: 'org-1',
      status: LessonStatus.SCHEDULED,
      scheduledAt: candidateWindow(input.interval),
      OR: [{ instructorId: 'instructor-1' }, { carId: 'car-1' }],
    });
  });

  it('excludes nothing for a new slot', async () => {
    await findSlotConflicts(tx as never, { ...input, slotId: null });

    const [slotArgs] = tx.practiceSlot.findMany.mock.calls[0];
    expect(slotArgs.where).not.toHaveProperty('id');
  });

  it('returns no conflicts when nothing overlaps', async () => {
    await expect(findSlotConflicts(tx as never, input)).resolves.toEqual([]);
  });

  it('reports a slot of the same instructor as INSTRUCTOR/SLOT', async () => {
    tx.practiceSlot.findMany.mockResolvedValue([
      row({ id: 'slot-2', instructorId: 'instructor-1' }),
    ]);

    await expect(findSlotConflicts(tx as never, input)).resolves.toEqual([
      {
        resource: 'INSTRUCTOR',
        resourceId: 'instructor-1',
        lessonType: 'SLOT',
        lessonId: 'slot-2',
        scheduledAt: at('2026-11-03T10:30:00Z'),
        endsAt: at('2026-11-03T11:30:00Z'),
      },
    ]);
  });

  it('reports a slot of the same car as CAR/SLOT', async () => {
    tx.practiceSlot.findMany.mockResolvedValue([
      row({ id: 'slot-2', carId: 'car-1' }),
    ]);

    const conflicts = await findSlotConflicts(tx as never, input);

    expect(conflicts.map((c) => [c.resource, c.lessonType])).toEqual([
      ['CAR', 'SLOT'],
    ]);
  });

  it('reports both resources of a slot with the same instructor and car', async () => {
    tx.practiceSlot.findMany.mockResolvedValue([
      row({ id: 'slot-2', instructorId: 'instructor-1', carId: 'car-1' }),
    ]);

    const conflicts = await findSlotConflicts(tx as never, input);

    expect(conflicts.map((c) => c.resource)).toEqual(['INSTRUCTOR', 'CAR']);
  });

  it('reports a SCHEDULED lesson of the instructor as INSTRUCTOR/PRACTICE', async () => {
    tx.drivingLesson.findMany.mockResolvedValue([
      row({ id: 'lesson-9', instructorId: 'instructor-1' }),
    ]);

    const conflicts = await findSlotConflicts(tx as never, input);

    expect(
      conflicts.map((c) => [c.resource, c.lessonType, c.lessonId]),
    ).toEqual([['INSTRUCTOR', 'PRACTICE', 'lesson-9']]);
  });

  it('ignores candidates that touch the slot end to start', async () => {
    tx.practiceSlot.findMany.mockResolvedValue([
      row({
        instructorId: 'instructor-1',
        scheduledAt: at('2026-11-03T09:00:00Z'),
      }),
      row({
        instructorId: 'instructor-1',
        scheduledAt: at('2026-11-03T11:00:00Z'),
      }),
    ]);

    await expect(findSlotConflicts(tx as never, input)).resolves.toEqual([]);
  });

  it('sorts INSTRUCTOR before CAR, then by start time', async () => {
    tx.practiceSlot.findMany.mockResolvedValue([
      row({
        id: 'slot-car',
        carId: 'car-1',
        scheduledAt: at('2026-11-03T09:30:00Z'),
      }),
    ]);
    tx.drivingLesson.findMany.mockResolvedValue([
      row({
        id: 'lesson-late',
        instructorId: 'instructor-1',
        scheduledAt: at('2026-11-03T10:45:00Z'),
      }),
      row({
        id: 'lesson-early',
        instructorId: 'instructor-1',
        scheduledAt: at('2026-11-03T10:15:00Z'),
      }),
    ]);

    const conflicts = await findSlotConflicts(tx as never, input);

    expect(conflicts.map((c) => c.lessonId)).toEqual([
      'lesson-early',
      'lesson-late',
      'slot-car',
    ]);
  });
});

describe('spanOf', () => {
  it('runs from the earliest start to the latest end, not the last row end', () => {
    const span = spanOf([
      { scheduledAt: at('2026-11-03T10:00:00Z'), durationMin: 240 },
      { scheduledAt: at('2026-11-03T11:00:00Z'), durationMin: 60 },
      { scheduledAt: at('2026-11-03T09:00:00Z'), durationMin: 30 },
    ]);

    expect(span).toEqual({
      start: at('2026-11-03T09:00:00Z'),
      end: at('2026-11-03T14:00:00Z'),
    });
  });
});

describe('findStudentSlotBlockers', () => {
  const tx = {
    drivingLesson: { findMany: jest.fn() },
    lesson: { findMany: jest.fn() },
  };
  const input = {
    organizationId: 'org-1',
    studentId: 'student-1',
    instructorId: 'instructor-1',
    carIds: ['car-1', 'car-2'],
    interval: {
      start: at('2026-11-03T10:00:00Z'),
      end: at('2026-11-03T14:00:00Z'),
    },
  };

  beforeEach(() => {
    tx.drivingLesson.findMany.mockReset().mockResolvedValue([]);
    tx.lesson.findMany.mockReset().mockResolvedValue([]);
  });

  it('queries SCHEDULED practice of the instructor, cars or student and theory of the student groups', async () => {
    await findStudentSlotBlockers(tx as never, input);

    const [practiceArgs] = tx.drivingLesson.findMany.mock.calls[0];
    expect(practiceArgs.where).toEqual({
      organizationId: 'org-1',
      status: LessonStatus.SCHEDULED,
      scheduledAt: candidateWindow(input.interval),
      OR: [
        { instructorId: 'instructor-1' },
        { carId: { in: ['car-1', 'car-2'] } },
        { studentId: 'student-1' },
      ],
    });
    const [theoryArgs] = tx.lesson.findMany.mock.calls[0];
    expect(theoryArgs.where).toEqual({
      organizationId: 'org-1',
      status: LessonStatus.SCHEDULED,
      scheduledAt: candidateWindow(input.interval),
      group: {
        enrollments: {
          some: { studentId: 'student-1', status: EnrollmentStatus.ACTIVE },
        },
      },
    });
  });

  it('returns practice as is and theory as busy time of the student', async () => {
    const practice = {
      instructorId: 'instructor-1',
      carId: null,
      studentId: 'student-2',
      scheduledAt: at('2026-11-03T10:00:00Z'),
      durationMin: 60,
    };
    tx.drivingLesson.findMany.mockResolvedValue([practice]);
    tx.lesson.findMany.mockResolvedValue([
      { scheduledAt: at('2026-11-03T12:00:00Z'), durationMin: 90 },
    ]);

    await expect(findStudentSlotBlockers(tx as never, input)).resolves.toEqual([
      practice,
      {
        instructorId: null,
        carId: null,
        studentId: 'student-1',
        scheduledAt: at('2026-11-03T12:00:00Z'),
        durationMin: 90,
      },
    ]);
  });
});

describe('isSlotFree', () => {
  // 10:00–11:00 UTC
  const slot = {
    instructorId: 'instructor-1',
    carId: 'car-1',
    scheduledAt: at('2026-11-03T10:00:00Z'),
    durationMin: 60,
  };
  const blocker = (overrides: Partial<SlotBlocker>): SlotBlocker => ({
    instructorId: 'instructor-2',
    carId: 'car-2',
    studentId: 'student-2',
    scheduledAt: at('2026-11-03T10:30:00Z'),
    durationMin: 60,
    ...overrides,
  });

  it('is free with no blockers', () => {
    expect(isSlotFree(slot, [], 'student-1')).toBe(true);
  });

  it.each([
    [
      'practice of the same instructor with another car',
      { instructorId: 'instructor-1' },
    ],
    ['practice of another instructor with the same car', { carId: 'car-1' }],
    [
      'practice of the student with another instructor',
      { studentId: 'student-1' },
    ],
    [
      'theory of a student group',
      { instructorId: null, carId: null, studentId: 'student-1' },
    ],
  ])('is busy with overlapping %s', (_, overrides) => {
    expect(isSlotFree(slot, [blocker(overrides)], 'student-1')).toBe(false);
  });

  it('is free when an overlapping lesson shares no instructor, car or student', () => {
    expect(isSlotFree(slot, [blocker({})], 'student-1')).toBe(true);
  });

  it.each([
    ['ends when the slot starts', '2026-11-03T09:00:00Z'],
    ['starts when the slot ends', '2026-11-03T11:00:00Z'],
  ])('is free when a lesson of the instructor %s', (_, start) => {
    expect(
      isSlotFree(
        slot,
        [blocker({ instructorId: 'instructor-1', scheduledAt: at(start) })],
        'student-1',
      ),
    ).toBe(true);
  });
});
