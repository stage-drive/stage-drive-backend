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
      ensureDemoAccountsIfEnabled(db, {
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

    await expect(provisionDemoAccounts(db)).resolves.toEqual([
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
    expect(db.car.upsert).toHaveBeenCalledTimes(2);
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

    await provisionDemoAccounts(db);

    expect(db.organization.create).not.toHaveBeenCalled();
    expect(db.organization.update).not.toHaveBeenCalled();
    expect(db.student.create).not.toHaveBeenCalled();
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
  } as unknown as PrismaClient & {
    organization: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    user: { upsert: jest.Mock; findFirst: jest.Mock };
    student: { findUnique: jest.Mock; create: jest.Mock };
    car: { upsert: jest.Mock };
  };
}
