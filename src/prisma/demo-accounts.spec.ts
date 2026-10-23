import { OrganizationStatus, PrismaClient, UserRole } from '@prisma/client';
import {
  ensureDemoAccountsIfEnabled,
  provisionDemoAccounts,
  shouldProvisionDemoAccounts,
} from './demo-accounts';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-demo'),
}));

describe('shouldProvisionDemoAccounts', () => {
  it('never provisions when NODE_ENV is production, even if the flag is on', () => {
    expect(
      shouldProvisionDemoAccounts({
        NODE_ENV: 'production',
        SEED_DEMO_USERS: 'true',
      }),
    ).toBe(false);
  });

  it('provisions in development by default', () => {
    expect(shouldProvisionDemoAccounts({ NODE_ENV: 'development' })).toBe(true);
  });

  it('stays off in development when SEED_DEMO_USERS is false', () => {
    expect(
      shouldProvisionDemoAccounts({
        NODE_ENV: 'development',
        SEED_DEMO_USERS: 'false',
      }),
    ).toBe(false);
  });

  it('stays off when the environment is unset', () => {
    expect(shouldProvisionDemoAccounts({})).toBe(false);
  });

  it('provisions a non-production environment only when the flag is on', () => {
    expect(
      shouldProvisionDemoAccounts({
        NODE_ENV: 'staging',
        SEED_DEMO_USERS: 'true',
      }),
    ).toBe(true);
    expect(shouldProvisionDemoAccounts({ NODE_ENV: 'staging' })).toBe(false);
  });
});

describe('ensureDemoAccountsIfEnabled', () => {
  it('does not touch the database in production', async () => {
    const db = createDb();

    await expect(
      ensureDemoAccountsIfEnabled(asPrisma(db), {
        NODE_ENV: 'production',
        SEED_DEMO_USERS: 'true',
      }),
    ).resolves.toBeNull();

    expect(db.organization.findUnique).not.toHaveBeenCalled();
    expect(db.user.upsert).not.toHaveBeenCalled();
  });
});

describe('provisionDemoAccounts', () => {
  it('upserts the four role logins and a student profile', async () => {
    const db = createDb();

    await expect(provisionDemoAccounts(asPrisma(db))).resolves.toEqual([
      'admin@example.com',
      'teacher@example.com',
      'instructor@example.com',
      'student@example.com',
    ]);

    expect(db.organization.create).toHaveBeenCalledTimes(1);
    expect(db.user.upsert).toHaveBeenCalledTimes(4);
    const roles = db.user.upsert.mock.calls.map(
      (call) => call[0].create.role as UserRole,
    );
    expect(roles).toEqual([
      UserRole.ADMIN,
      UserRole.TEACHER,
      UserRole.INSTRUCTOR,
      UserRole.STUDENT,
    ]);
    expect(db.user.upsert.mock.calls[0][0].update.passwordHash).toBe(
      'hashed-demo',
    );
    expect(db.student.create).toHaveBeenCalledTimes(1);
    expect(db.car.upsert).toHaveBeenCalledTimes(5);
    expect(db.car.upsert.mock.calls[0][0].create).toMatchObject({
      plateNumber: 'AA0001BB',
      instructorId: '23232323-2323-4232-8232-232323232323',
      organizationId: '11111111-1111-1111-1111-111111111111',
    });
  });

  it('reuses an existing school and does not duplicate the student profile', async () => {
    const db = createDb();
    db.organization.findUnique.mockResolvedValue({
      id: 'existing-org',
      deletedAt: null,
      status: OrganizationStatus.ACTIVE,
    });
    db.student.findUnique.mockResolvedValue({ id: 'existing-profile' });

    await provisionDemoAccounts(asPrisma(db));

    expect(db.organization.create).not.toHaveBeenCalled();
    expect(db.organization.update).not.toHaveBeenCalled();
    expect(db.student.create).not.toHaveBeenCalled();
  });

  it('restores a demo login whose email was changed, by its fixed id', async () => {
    const db = createDb();

    await provisionDemoAccounts(asPrisma(db));

    const admin = db.user.upsert.mock.calls[0][0];
    expect(admin.where).toEqual({ id: '66666666-6666-6666-6666-666666666666' });
    expect(admin.update.email).toBe('admin@example.com');
  });

  it('updates a demo login found by email even if its id differs', async () => {
    const db = createDb();
    db.user.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(
        where.email === 'admin@example.com' ? { id: 'legacy-admin' } : null,
      ),
    );

    await provisionDemoAccounts(asPrisma(db));

    expect(db.user.upsert.mock.calls[0][0].where).toEqual({
      id: 'legacy-admin',
    });
  });
});

function createDb() {
  return {
    organization: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: data.id,
          deletedAt: null,
          status: OrganizationStatus.ACTIVE,
        }),
      ),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockImplementation(({ create }) =>
        Promise.resolve({
          id: create.id,
          email: create.email,
          role: create.role,
        }),
      ),
      findFirst: jest.fn().mockImplementation(({ where }) => {
        if (where.role !== UserRole.INSTRUCTOR) {
          return Promise.resolve(null);
        }
        return Promise.resolve({
          id: where.id,
          organizationId: where.organizationId,
          role: where.role,
        });
      }),
    },
    student: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'profile' }),
    },
    car: {
      upsert: jest.fn().mockResolvedValue({ id: 'car' }),
    },
  };
}

/**
 * The code under test wants a PrismaClient; assertions go through the plain
 * jest.fn() mocks, so they are not unbound PrismaClient methods.
 */
function asPrisma(db: ReturnType<typeof createDb>): PrismaClient {
  return db as unknown as PrismaClient;
}
