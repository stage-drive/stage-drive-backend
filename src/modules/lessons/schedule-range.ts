import { BadRequestException } from '@nestjs/common';
import {
  SCHEDULE_DEFAULT_RANGE_DAYS,
  SCHEDULE_MAX_RANGE_DAYS,
  SCHEDULE_RANGE_LENGTH_MESSAGE,
  SCHEDULE_RANGE_ORDER_MESSAGE,
} from './lessons.dto';
import { ScheduleSlot } from './schedule-conflicts';

const DAY_MS = 24 * 60 * 60_000;

/** Необов'язкове вікно списку. null на межі означає відкритий кінець. */
export type OptionalScheduleRange = {
  start: Date | null;
  end: Date | null;
};

export function fieldError(
  field: string,
  message: string,
): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    errors: [{ field, message }],
  });
}

/**
 * Вікно [from, to) для списків розкладу: персонального й слотів. Формат from і
 * to уже перевірив DTO; тут — правила, що зв'язують обидва поля.
 */
export function resolveRange(
  query: { from?: string; to?: string },
  now: Date,
): ScheduleSlot {
  const start = query.from ? new Date(query.from) : now;
  const end = query.to
    ? new Date(query.to)
    : new Date(start.getTime() + SCHEDULE_DEFAULT_RANGE_DAYS * DAY_MS);

  if (end.getTime() <= start.getTime()) {
    throw fieldError('to', SCHEDULE_RANGE_ORDER_MESSAGE);
  }
  if (end.getTime() - start.getTime() > SCHEDULE_MAX_RANGE_DAYS * DAY_MS) {
    throw fieldError('to', SCHEDULE_RANGE_LENGTH_MESSAGE);
  }
  return { start, end };
}

/**
 * Необов'язкове вікно списку теорії. Без from і to — null, тобто всі заняття.
 * Одна межа лишає інший кінець відкритим. Обидві — [from, to) не довше
 * SCHEDULE_MAX_RANGE_DAYS. Формат меж уже перевірив DTO.
 */
export function resolveOptionalRange(query: {
  from?: string;
  to?: string;
}): OptionalScheduleRange | null {
  if (!query.from && !query.to) {
    return null;
  }
  const start = query.from ? new Date(query.from) : null;
  const end = query.to ? new Date(query.to) : null;
  if (start && end) {
    if (end.getTime() <= start.getTime()) {
      throw fieldError('to', SCHEDULE_RANGE_ORDER_MESSAGE);
    }
    if (end.getTime() - start.getTime() > SCHEDULE_MAX_RANGE_DAYS * DAY_MS) {
      throw fieldError('to', SCHEDULE_RANGE_LENGTH_MESSAGE);
    }
  }
  return { start, end };
}
