import { Prisma } from '@prisma/client';

// meta.target holds Prisma field names (camelCase). The driver-adapter
// fallback surfaces raw Postgres column names (snake_case) instead, so it
// must be normalized to the same casing before comparison.
function toCamelCase(column: string): string {
  return column.replace(/_([a-z0-9])/g, (_, char: string) =>
    char.toUpperCase(),
  );
}

function uniqueConstraintFields(
  error: Prisma.PrismaClientKnownRequestError,
): string[] {
  const meta = error.meta as
    | {
        target?: string[] | string;
        driverAdapterError?: {
          cause?: { constraint?: { fields?: string[] } };
        };
      }
    | undefined;
  const target = meta?.target;
  if (typeof target === 'string') {
    return [target];
  }
  if (target) {
    return target;
  }
  const rawColumns = meta?.driverAdapterError?.cause?.constraint?.fields ?? [];
  return rawColumns.map(toCamelCase);
}

export function isUniqueConstraintOn(error: unknown, field: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    uniqueConstraintFields(error).includes(field)
  );
}
