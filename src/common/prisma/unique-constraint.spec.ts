import { Prisma } from '@prisma/client';
import { isUniqueConstraintOn } from './unique-constraint';

function uniqueError(meta: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.9.1',
    meta,
  });
}

describe('isUniqueConstraintOn', () => {
  it('matches Prisma meta.target field names', () => {
    const error = uniqueError({ target: ['email'] });
    expect(isUniqueConstraintOn(error, 'email')).toBe(true);
    expect(isUniqueConstraintOn(error, 'slug')).toBe(false);
  });

  it('matches driver-adapter constraint.fields in snake_case', () => {
    const error = uniqueError({
      driverAdapterError: {
        cause: { constraint: { fields: ['provider_account_id'] } },
      },
    });
    expect(isUniqueConstraintOn(error, 'providerAccountId')).toBe(true);
  });

  it('matches driver-adapter unique index names like users_email_key', () => {
    const error = uniqueError({
      driverAdapterError: {
        cause: { constraint: { index: 'users_email_key' } },
      },
    });
    expect(isUniqueConstraintOn(error, 'email')).toBe(true);
    expect(isUniqueConstraintOn(error, 'slug')).toBe(false);
  });
});
