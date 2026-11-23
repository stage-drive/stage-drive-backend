import { lockedLessonIds } from './lesson-gate';

const lesson = (id: string, chapterPosition: number, position: number) => ({
  id,
  chapterPosition,
  position,
});

describe('lockedLessonIds', () => {
  const ordered = [
    lesson('a', 1, 1),
    lesson('b', 1, 2),
    lesson('c', 2, 1),
  ];

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
