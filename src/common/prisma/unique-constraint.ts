import { Prisma } from '@prisma/client';

// meta.target holds Prisma field names (camelCase). The driver-adapter
// fallback surfaces raw Postgres column names (snake_case) or the unique
// index name (`users_email_key`) instead, so both must be normalized.
function toCamelCase(column: string): string {
  return column.replace(/_([a-z0-9])/g, (_, char: string) =>
    char.toUpperCase(),
  );
}

function toSnakeCase(field: string): string {
  return field.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}

type UniqueConstraintMeta = {
  target?: string[] | string;
  driverAdapterError?: {
    cause?: { constraint?: { fields?: string[]; index?: string } };
  };
};

function constraintIndex(
  error: Prisma.PrismaClientKnownRequestError,
): string | undefined {
  const meta = error.meta as UniqueConstraintMeta | undefined;
  return meta?.driverAdapterError?.cause?.constraint?.index;
}

function uniqueConstraintFields(
  error: Prisma.PrismaClientKnownRequestError,
): string[] {
  const meta = error.meta as UniqueConstraintMeta | undefined;
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
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }
  if (uniqueConstraintFields(error).includes(field)) {
    return true;
  }
  const index = constraintIndex(error);
  if (!index) {
    return false;
  }
  const snake = toSnakeCase(field);
  return index === `${snake}_key` || index.endsWith(`_${snake}_key`);
}
