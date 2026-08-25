import { Prisma } from '@prisma/client';

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
  return target ?? meta?.driverAdapterError?.cause?.constraint?.fields ?? [];
}

export function isUniqueConstraintOn(error: unknown, field: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    uniqueConstraintFields(error).includes(field)
  );
}
