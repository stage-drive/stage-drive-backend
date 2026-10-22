import { Prisma } from '@prisma/client';
import {
  lockPracticeLesson,
  lockScheduleResources,
  lockTheoryLesson,
  scheduleLockKey,
} from './schedule-lock';

describe('schedule locks', () => {
  const tx = { $executeRaw: jest.fn(), $queryRaw: jest.fn() };

  beforeEach(() => {
    tx.$executeRaw.mockReset();
    tx.$executeRaw.mockResolvedValue(1);
    tx.$queryRaw.mockReset();
    tx.$queryRaw.mockResolvedValue([]);
  });

  // $executeRaw / $queryRaw are tagged templates: rebuild each call into
  // Prisma.Sql to see the final Postgres text and the bound values.
  function executed(mock: jest.Mock, index = 0) {
    const [strings, ...values] = mock.mock.calls[index] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const query = Prisma.sql(strings, ...values);
    return {
      text: query.text.replace(/\s+/g, ' ').trim(),
      values: query.values,
    };
  }

  describe('lockScheduleResources', () => {
    it('takes one advisory lock per unique key in sorted order', async () => {
      await lockScheduleResources(tx as never, [
        scheduleLockKey('student', 'b'),
        scheduleLockKey('car', 'a'),
        scheduleLockKey('student', 'b'),
      ]);

      expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
      expect(executed(tx.$executeRaw, 0)).toEqual({
        text: 'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
        values: ['car:a'],
      });
      expect(executed(tx.$executeRaw, 1).values).toEqual(['student:b']);
    });

    it('does nothing for an empty key list', async () => {
      await lockScheduleResources(tx as never, []);

      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });

    it('binds the key as a parameter instead of splicing it into the SQL', async () => {
      const injection = scheduleLockKey('car', "x'); DROP TABLE cars; --");

      await lockScheduleResources(tx as never, [injection]);

      const { text, values } = executed(tx.$executeRaw);
      expect(text).not.toContain('DROP TABLE');
      expect(values).toEqual([injection]);
    });
  });

  it('locks a theory lesson row scoped to the organization through its group', async () => {
    await lockTheoryLesson(tx as never, 'lesson-1', 'org-1');

    expect(executed(tx.$queryRaw)).toEqual({
      text:
        'SELECT l.id FROM lessons l JOIN groups g ON g.id = l.group_id ' +
        'WHERE l.id = $1::uuid AND g.organization_id = $2::uuid FOR UPDATE OF l',
      values: ['lesson-1', 'org-1'],
    });
  });

  it('locks a practice lesson row scoped to the organization', async () => {
    await lockPracticeLesson(tx as never, 'lesson-1', 'org-1');

    expect(executed(tx.$queryRaw)).toEqual({
      text:
        'SELECT id FROM driving_lessons ' +
        'WHERE id = $1::uuid AND organization_id = $2::uuid FOR UPDATE',
      values: ['lesson-1', 'org-1'],
    });
  });
});
