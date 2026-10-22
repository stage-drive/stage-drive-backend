import { BadRequestException } from '@nestjs/common';

export type PositionRow = {
  id: string;
  position: number;
};

export type PositionUpdate = (id: string, position: number) => Promise<void>;

export function positionRangeMessage(max: number): string {
  return `Позиція має бути цілим числом від 1 до ${max}.`;
}

function fieldError(message: string): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    errors: [{ field: 'position', message }],
  });
}

/** Позиція нового елемента: без значення — у кінець, інакше 1…count+1. */
export function assertInsertPosition(
  count: number,
  requested?: number,
): number {
  const max = count + 1;
  if (requested === undefined) {
    return max;
  }
  if (!Number.isInteger(requested) || requested < 1 || requested > max) {
    throw fieldError(positionRangeMessage(max));
  }
  return requested;
}

/** Позиція наявного елемента: 1…count. */
export function assertMovePosition(count: number, requested: number): number {
  if (!Number.isInteger(requested) || requested < 1 || requested > count) {
    throw fieldError(positionRangeMessage(Math.max(count, 1)));
  }
  return requested;
}

/**
 * Звільняє position для вставки. Зсув іде від більшої позиції до меншої,
 * щоб унікальний (parent, position) не зіткнувся посеред оновлення.
 */
export async function shiftForInsert(
  rows: PositionRow[],
  position: number,
  update: PositionUpdate,
): Promise<void> {
  const shifting = rows
    .filter((row) => row.position >= position)
    .sort((a, b) => b.position - a.position);
  for (const row of shifting) {
    await update(row.id, row.position + 1);
  }
}

/**
 * Переносить елемент, тимчасово паркуючи його на від'ємній позиції.
 * Від'ємне значення живе лише до кінця транзакції: фінальний запис ставить ціль.
 */
export async function shiftForMove(
  rows: PositionRow[],
  id: string,
  from: number,
  to: number,
  update: PositionUpdate,
): Promise<void> {
  if (from === to) {
    return;
  }
  await update(id, -from);
  if (to > from) {
    const between = rows
      .filter(
        (row) => row.id !== id && row.position > from && row.position <= to,
      )
      .sort((a, b) => a.position - b.position);
    for (const row of between) {
      await update(row.id, row.position - 1);
    }
    return;
  }
  const between = rows
    .filter((row) => row.id !== id && row.position >= to && row.position < from)
    .sort((a, b) => b.position - a.position);
  for (const row of between) {
    await update(row.id, row.position + 1);
  }
}
