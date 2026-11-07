import { BadRequestException } from '@nestjs/common';
import {
  SCHEDULE_DEFAULT_RANGE_DAYS,
  SCHEDULE_MAX_RANGE_DAYS,
  SCHEDULE_RANGE_LENGTH_MESSAGE,
  SCHEDULE_RANGE_ORDER_MESSAGE,
} from './lessons.dto';
import { ScheduleSlot } from './schedule-conflicts';

const DAY_MS = 24 * 60 * 60_000;

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
