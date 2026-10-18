import { Prisma } from '@prisma/client';
import { lockGroup } from './group-lock';

describe('lockGroup', () => {
  const tx = { $queryRaw: jest.fn() };

  beforeEach(() => {
    tx.$queryRaw.mockReset();
    tx.$queryRaw.mockResolvedValue([]);
  });

  // $queryRaw is a tagged template: rebuild the call into Prisma.Sql to see
  // the final Postgres text with placeholders and the bound values.
  function executedQuery(): { text: string; values: unknown[] } {
    const [strings, ...values] = tx.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const query = Prisma.sql(strings, ...values);
    return {
      text: query.text.replace(/\s+/g, ' ').trim(),
      values: query.values,
    };
  }

  it.each([
    ['update', 'FOR UPDATE'],
    ['share', 'FOR SHARE'],
  ] as const)('locks the group row with %s mode', async (mode, clause) => {
    await lockGroup(tx as never, 'group-1', 'org-1', mode);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(executedQuery()).toEqual({
      text: `SELECT id FROM groups WHERE id = $1::uuid AND organization_id = $2::uuid ${clause}`,
      values: ['group-1', 'org-1'],
    });
  });

  it('binds ids as parameters instead of splicing them into the SQL', async () => {
    const injection = "group-1'; DROP TABLE groups; --";

    await lockGroup(tx as never, injection, 'org-1', 'update');

    const { text, values } = executedQuery();
    expect(text).not.toContain('DROP TABLE');
    expect(values).toEqual([injection, 'org-1']);
  });

  it('resolves without a value even when the row is not found', async () => {
    await expect(
      lockGroup(tx as never, 'missing', 'org-1', 'share'),
    ).resolves.toBeUndefined();
  });
});
