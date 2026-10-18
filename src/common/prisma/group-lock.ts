import { Prisma } from '@prisma/client';

export type GroupLockMode = 'update' | 'share';

/**
 * Блокує рядок групи до кінця транзакції. Prisma Client не має FOR UPDATE /
 * FOR SHARE, тому raw SQL. Група іншої організації не блокується: запит нічого
 * не знаходить, а 404 кидає подальша перевірка групи.
 *
 * 'update' — зміна статусу групи; 'share' — зарахування студента в групу.
 * Зарахування між собою не конфліктують, але чекають на закриття групи.
 */
export async function lockGroup(
  tx: Prisma.TransactionClient,
  groupId: string,
  organizationId: string,
  mode: GroupLockMode,
): Promise<void> {
  const lock =
    mode === 'update' ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`;
  await tx.$queryRaw`
    SELECT id FROM groups
    WHERE id = ${groupId}::uuid AND organization_id = ${organizationId}::uuid
    ${lock}
  `;
}
