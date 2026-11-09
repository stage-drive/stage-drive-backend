import { DayOfWeek } from '@prisma/client';
import {
  addDays,
  isoWeekday,
  localDate,
  zonedTimeToUtc,
} from '../../common/time/zoned-time';
import { PRACTICE_DEFAULT_DURATION_MIN } from './lessons.dto';
import {
  ScheduleSlot,
  SlotBlocker,
  isSlotFree,
  lessonSlot,
} from './schedule-conflicts';

/**
 * Обчислення вільних слотів практики з робочого графіка інструктора.
 * Чисті функції: дані приходять готовими, БД не потрібна.
 */

/** Тривалість заняття, яке бронює студент, і крок сітки слотів. */
export const PRACTICE_BOOKING_DURATION_MIN = PRACTICE_DEFAULT_DURATION_MIN;

/** DayOfWeek в порядку ISO: індекс 0 — понеділок. */
const ISO_DAYS: readonly DayOfWeek[] = Object.values(DayOfWeek);

export type WorkingHoursRow = {
  dayOfWeek: DayOfWeek;
  startMinute: number;
  endMinute: number;
};

export type TimeOffRow = { startsAt: Date; endsAt: Date };

/**
 * Старти слотів, що починаються у вікні [range.start, range.end): для кожного
 * місцевого дня — інтервали його дня тижня, нарізані з кроком durationMin від
 * початку інтервалу, поки заняття вміщується до кінця інтервалу. Місцевий час,
 * якого немає (перехід на літній час), пропускається. За зростанням.
 */
export function slotStarts(input: {
  range: ScheduleSlot;
  timeZone: string;
  durationMin: number;
  workingHours: readonly WorkingHoursRow[];
}): Date[] {
  const { range, timeZone, durationMin, workingHours } = input;
  const starts: Date[] = [];
  const lastDay = localDate(range.end, timeZone);

  for (
    let day = localDate(range.start, timeZone);
    day <= lastDay;
    day = addDays(day, 1)
  ) {
    const dayOfWeek = ISO_DAYS[isoWeekday(day) - 1];
    const intervals = workingHours
      .filter((row) => row.dayOfWeek === dayOfWeek)
      .sort((a, b) => a.startMinute - b.startMinute);
    for (const interval of intervals) {
      for (
        let minute = interval.startMinute;
        minute + durationMin <= interval.endMinute;
        minute += durationMin
      ) {
        const start = zonedTimeToUtc(day, minute, timeZone);
        if (
          start &&
          start.getTime() >= range.start.getTime() &&
          start.getTime() < range.end.getTime()
        ) {
          starts.push(start);
        }
      }
    }
  }
  return starts;
}

/** Напіввідкриті інтервали, як overlaps у schedule-conflicts. */
function overlapsTimeOff(slot: ScheduleSlot, timeOff: TimeOffRow): boolean {
  return (
    timeOff.startsAt.getTime() < slot.end.getTime() &&
    timeOff.endsAt.getTime() > slot.start.getTime()
  );
}

/**
 * Вільні слоти для студента: старти сітки, що ще не настали, не перетинають
 * недоступність інструктора і не зайняті заняттями інструктора, авто чи
 * студента (blockers — з findStudentSlotBlockers).
 */
export function computeAvailableSlots(input: {
  range: ScheduleSlot;
  timeZone: string;
  now: Date;
  durationMin: number;
  workingHours: readonly WorkingHoursRow[];
  timeOffs: readonly TimeOffRow[];
  blockers: readonly SlotBlocker[];
  instructorId: string;
  carId: string;
  studentId: string;
}): Date[] {
  return slotStarts(input).filter((scheduledAt) => {
    if (scheduledAt.getTime() <= input.now.getTime()) {
      return false;
    }
    const slot = lessonSlot(scheduledAt, input.durationMin);
    if (input.timeOffs.some((timeOff) => overlapsTimeOff(slot, timeOff))) {
      return false;
    }
    return isSlotFree(
      {
        instructorId: input.instructorId,
        carId: input.carId,
        scheduledAt,
        durationMin: input.durationMin,
      },
      input.blockers,
      input.studentId,
    );
  });
}

/** Чи є момент одним зі стартів сітки робочого графіка. */
export function isSlotStart(input: {
  scheduledAt: Date;
  timeZone: string;
  durationMin: number;
  workingHours: readonly WorkingHoursRow[];
}): boolean {
  const { scheduledAt } = input;
  return slotStarts({
    ...input,
    range: { start: scheduledAt, end: new Date(scheduledAt.getTime() + 1) },
  }).some((start) => start.getTime() === scheduledAt.getTime());
}
