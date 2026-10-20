import { BadRequestException } from '@nestjs/common';
import {
  assertInsertPosition,
  assertMovePosition,
  PositionRow,
  positionRangeMessage,
  shiftForInsert,
  shiftForMove,
} from './course-structure.order';

function table(positions: number[]) {
  const rows: PositionRow[] = positions.map((position, index) => ({
    id: `id-${index + 1}`,
    position,
  }));
  const update = jest.fn((id: string, position: number) => {
    if (rows.some((row) => row.id !== id && row.position === position)) {
      throw new Error(`position collision ${id} -> ${position}`);
    }
    const row = rows.find((item) => item.id === id);
    if (!row) {
      throw new Error(`missing ${id}`);
    }
    row.position = position;
    return Promise.resolve();
  });
  return { rows, update };
}

function ordered(rows: PositionRow[]) {
  return [...rows]
    .sort((left, right) => left.position - right.position)
    .map((row) => row.id);
}

describe('course structure order', () => {
  it('appends when position is omitted and rejects a position past the end', () => {
    expect(assertInsertPosition(2)).toBe(3);
    expect(assertInsertPosition(2, 1)).toBe(1);
    expect(assertInsertPosition(0, 1)).toBe(1);

    expect(() => assertInsertPosition(2, 4)).toThrow(BadRequestException);
    try {
      assertInsertPosition(2, 4);
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'position', message: positionRangeMessage(3) }],
      });
    }
  });

  it('rejects a move outside 1..count', () => {
    expect(assertMovePosition(3, 2)).toBe(2);
    expect(() => assertMovePosition(3, 4)).toThrow(BadRequestException);
  });

  it('inserts in the middle without duplicate positions', async () => {
    const { rows, update } = table([1, 2, 3]);

    await shiftForInsert(rows, 2, update);

    expect(ordered(rows)).toEqual(['id-1', 'id-2', 'id-3']);
    expect(rows.map((row) => row.position).sort()).toEqual([1, 3, 4]);
  });

  it('moves an item down and up without duplicate positions', async () => {
    const down = table([1, 2, 3]);
    await shiftForMove(down.rows, 'id-1', 1, 3, down.update);
    await down.update('id-1', 3);
    expect(ordered(down.rows)).toEqual(['id-2', 'id-3', 'id-1']);

    const up = table([1, 2, 3]);
    await shiftForMove(up.rows, 'id-3', 3, 1, up.update);
    await up.update('id-3', 1);
    expect(ordered(up.rows)).toEqual(['id-3', 'id-1', 'id-2']);
  });
});
