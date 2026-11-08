import { DayOfWeek } from '@prisma/client';
import {
  PRACTICE_BOOKING_DURATION_MIN,
  WorkingHoursRow,
  computeAvailableSlots,
  isSlotStart,
  slotStarts,
} from './availability';
import { SlotBlocker } from './schedule-conflicts';

const KYIV = 'Europe/Kyiv';
const at = (iso: string) => new Date(iso);
const iso = (dates: Date[]) => dates.map((date) => date.toISOString());

/** Пн 09:00–13:00 і 14:00–18:00, вт 10:00–14:00. */
const WEEK: WorkingHoursRow[] = [
  { dayOfWeek: DayOfWeek.MONDAY, startMinute: 840, endMinute: 1080 },
  { dayOfWeek: DayOfWeek.MONDAY, startMinute: 540, endMinute: 780 },
  { dayOfWeek: DayOfWeek.TUESDAY, startMinute: 600, endMinute: 840 },
];

/** Понеділок 16.11.2026 за Києвом (UTC+2). */
const MONDAY = {
  start: at('2026-11-15T22:00:00Z'),
  end: at('2026-11-16T22:00:00Z'),
};

describe('slotStarts', () => {
  const starts = (range = MONDAY, workingHours = WEEK, durationMin = 120) =>
    iso(slotStarts({ range, timeZone: KYIV, durationMin, workingHours }));

  it('cuts each interval into lesson-long steps from its start, skipping the break', () => {
    // 09:00, 11:00 | 14:00, 16:00 за Києвом.
    expect(starts()).toEqual([
      '2026-11-16T07:00:00.000Z',
      '2026-11-16T09:00:00.000Z',
      '2026-11-16T12:00:00.000Z',
      '2026-11-16T14:00:00.000Z',
    ]);
  });

  it('drops the tail of an interval that cannot hold a whole lesson', () => {
    const hours = [
      { dayOfWeek: DayOfWeek.MONDAY, startMinute: 540, endMinute: 750 },
      { dayOfWeek: DayOfWeek.MONDAY, startMinute: 900, endMinute: 1000 },
    ];

    // 09:00–12:30 → лише 09:00; 15:00–16:40 коротший за заняття.
    expect(starts(MONDAY, hours)).toEqual(['2026-11-16T07:00:00.000Z']);
  });

  it('uses the step it is given', () => {
    expect(starts(MONDAY, WEEK, 60)).toHaveLength(8);
  });

  it('covers every day of a longer window and only matching weekdays', () => {
    const week = { start: MONDAY.start, end: at('2026-11-22T22:00:00Z') };

    expect(starts(week)).toEqual([
      '2026-11-16T07:00:00.000Z',
      '2026-11-16T09:00:00.000Z',
      '2026-11-16T12:00:00.000Z',
      '2026-11-16T14:00:00.000Z',
      // Вівторок 10:00 і 12:00.
      '2026-11-17T08:00:00.000Z',
      '2026-11-17T10:00:00.000Z',
    ]);
  });

  it('keeps starts inside [start, end): the start is included, the end is not', () => {
    const range = {
      start: at('2026-11-16T09:00:00Z'),
      end: at('2026-11-16T14:00:00Z'),
    };

    expect(starts(range)).toEqual([
      '2026-11-16T09:00:00.000Z',
      '2026-11-16T12:00:00.000Z',
    ]);
  });

  it('returns nothing without working hours', () => {
    expect(starts(MONDAY, [])).toEqual([]);
  });

  it('skips a start that does not exist on the spring-forward day', () => {
    // Неділя 28.03.2027: о 03:00 Київ переходить на 04:00.
    const sunday = {
      start: at('2027-03-27T22:00:00Z'),
      end: at('2027-03-28T21:00:00Z'),
    };
    const hours = [
      { dayOfWeek: DayOfWeek.SUNDAY, startMinute: 180, endMinute: 540 },
    ];

    // 03:00 немає; 05:00 і 07:00 — уже за літнім часом (UTC+3).
    expect(starts(sunday, hours)).toEqual([
      '2027-03-28T02:00:00.000Z',
      '2027-03-28T04:00:00.000Z',
    ]);
  });
});

describe('computeAvailableSlots', () => {
  const base = {
    range: MONDAY,
    timeZone: KYIV,
    now: at('2026-11-10T10:00:00Z'),
    durationMin: PRACTICE_BOOKING_DURATION_MIN,
    workingHours: WEEK,
    timeOffs: [] as { startsAt: Date; endsAt: Date }[],
    blockers: [] as SlotBlocker[],
    instructorId: 'instructor-1',
    carId: 'car-1',
    studentId: 'student-1',
  };

  const blocker = (overrides: Partial<SlotBlocker>): SlotBlocker => ({
    instructorId: null,
    carId: null,
    studentId: null,
    scheduledAt: at('2026-11-16T09:00:00Z'),
    durationMin: 120,
    ...overrides,
  });

  it('returns every start of the grid when nothing is taken', () => {
    expect(iso(computeAvailableSlots(base))).toHaveLength(4);
  });

  it('hides starts that are not in the future', () => {
    const now = at('2026-11-16T09:00:00Z');

    expect(iso(computeAvailableSlots({ ...base, now }))).toEqual([
      '2026-11-16T12:00:00.000Z',
      '2026-11-16T14:00:00.000Z',
    ]);
  });

  it('hides starts that overlap time off, but not one that ends as it begins', () => {
    // Лікар 16:00–18:00 за Києвом і ще 10:30–11:30.
    const timeOffs = [
      {
        startsAt: at('2026-11-16T14:00:00Z'),
        endsAt: at('2026-11-16T16:00:00Z'),
      },
      {
        startsAt: at('2026-11-16T08:30:00Z'),
        endsAt: at('2026-11-16T09:30:00Z'),
      },
    ];

    expect(iso(computeAvailableSlots({ ...base, timeOffs }))).toEqual([
      '2026-11-16T12:00:00.000Z',
    ]);
  });

  it.each([
    ['the instructor', { instructorId: 'instructor-1' }],
    ['the car', { carId: 'car-1' }],
    ['the student (practice or group theory)', { studentId: 'student-1' }],
  ])('hides a start taken by %s', (_, owner) => {
    const result = computeAvailableSlots({
      ...base,
      blockers: [blocker(owner)],
    });

    expect(iso(result)).not.toContain('2026-11-16T09:00:00.000Z');
    expect(result).toHaveLength(3);
  });

  it('ignores a lesson of other people and a lesson right before the slot', () => {
    const result = computeAvailableSlots({
      ...base,
      blockers: [
        blocker({
          instructorId: 'instructor-2',
          carId: 'car-2',
          studentId: 'student-2',
        }),
        blocker({
          instructorId: 'instructor-1',
          scheduledAt: at('2026-11-16T05:00:00Z'),
        }),
      ],
    });

    expect(result).toHaveLength(4);
  });

  it('hides a start when a longer lesson runs into it', () => {
    // 90-хвилинна теорія з 10:30 за Києвом заходить у слот 11:00.
    const result = computeAvailableSlots({
      ...base,
      blockers: [
        blocker({
          studentId: 'student-1',
          scheduledAt: at('2026-11-16T08:30:00Z'),
          durationMin: 90,
        }),
      ],
    });

    expect(iso(result)).toEqual([
      '2026-11-16T12:00:00.000Z',
      '2026-11-16T14:00:00.000Z',
    ]);
  });
});

describe('isSlotStart', () => {
  const check = (scheduledAt: string) =>
    isSlotStart({
      scheduledAt: at(scheduledAt),
      timeZone: KYIV,
      durationMin: 120,
      workingHours: WEEK,
    });

  it.each([
    ['09:00 on Monday', '2026-11-16T07:00:00Z', true],
    ['16:00 on Monday', '2026-11-16T14:00:00Z', true],
    ['10:00 on Monday, off the grid', '2026-11-16T08:00:00Z', false],
    ['13:00 on Monday, the break', '2026-11-16T11:00:00Z', false],
    ['09:00 on Wednesday, a day off', '2026-11-18T07:00:00Z', false],
    ['09:00:30 on Monday', '2026-11-16T07:00:30Z', false],
  ])('%s → %s', (_, scheduledAt, expected) => {
    expect(check(scheduledAt)).toBe(expected);
  });
});
