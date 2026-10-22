import { Prisma } from '@prisma/client';

export type ScheduleResource =
  'teacher' | 'instructor' | 'group' | 'car' | 'student';

export type ScheduleLockKey = `${ScheduleResource}:${string}`;

export function scheduleLockKey(
  resource: ScheduleResource,
  id: string,
): ScheduleLockKey {
  return `${resource}:${id}`;
}

/**
 * Серіалізує зміни розкладу, що зачіпають ті самі ресурси (викладач,
 * інструктор, група, авто, студент). Advisory-lock тримається до кінця
 * транзакції. Ключі сортуються, щоб дві транзакції з однаковим набором
 * ресурсів не взяли їх у різному порядку (deadlock). Колізія хешів лише
 * зайвий раз серіалізує дві транзакції.
 *
 * Ключі беруться по одному: Postgres не гарантує порядок виклику функцій
 * в одному SELECT … FROM unnest(…).
 */
export async function lockScheduleResources(
  tx: Prisma.TransactionClient,
  keys: readonly ScheduleLockKey[],
): Promise<void> {
  const ordered = [...new Set(keys)].sort();
  for (const key of ordered) {
    // $executeRaw: pg_advisory_xact_lock повертає void, а $queryRaw у Prisma
    // може впасти на десеріалізації колонки типу void.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}::text, 0))`;
  }
}

/**
 * Блокує рядок теоретичного заняття до кінця транзакції. Заняття іншої
 * організації не блокується: запит нічого не знаходить, а 404 кидає
 * подальше читання заняття.
 */
export async function lockTheoryLesson(
  tx: Prisma.TransactionClient,
  lessonId: string,
  organizationId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT l.id FROM lessons l
    JOIN groups g ON g.id = l.group_id
    WHERE l.id = ${lessonId}::uuid AND g.organization_id = ${organizationId}::uuid
    FOR UPDATE OF l
  `;
}

/** Те саме для практичного заняття. */
export async function lockPracticeLesson(
  tx: Prisma.TransactionClient,
  lessonId: string,
  organizationId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM driving_lessons
    WHERE id = ${lessonId}::uuid AND organization_id = ${organizationId}::uuid
    FOR UPDATE
  `;
}
