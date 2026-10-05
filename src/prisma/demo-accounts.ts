import {
  LicenseCategory,
  OrganizationStatus,
  PrismaClient,
  TrainingStatus,
  Transmission,
  UserRole,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

/** Shared demo password. Login does not re-check complexity; this matches prisma/seed.ts. */
export const DEMO_PASSWORD = 'Password1';

const DEMO_ORG_ID = '11111111-1111-1111-1111-111111111111';
const DEMO_ORG_SLUG = 'stage-drive-school';
const DEMO_ORG_EMAIL = 'owner@example.com';
const DEMO_ORG_NAME = 'Stage Drive School';

const DEMO_INSTRUCTOR_ID = '23232323-2323-4232-8232-232323232323';
const DEMO_CAR_MANUAL_ID = '31313131-3131-4131-8131-313131313131';
const DEMO_CAR_AUTOMATIC_ID = '32323232-3232-4232-8232-323232323232';

const DEMO_ACCOUNTS = [
  {
    id: '66666666-6666-6666-6666-666666666666',
    email: 'admin@example.com',
    firstName: 'Maria',
    lastName: 'Ivanenko',
    role: UserRole.ADMIN,
  },
  {
    id: 'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7',
    email: 'teacher@example.com',
    firstName: 'Natalia',
    lastName: 'Bondar',
    role: UserRole.TEACHER,
  },
  {
    id: DEMO_INSTRUCTOR_ID,
    email: 'instructor@example.com',
    firstName: 'Taras',
    lastName: 'Shevchenko',
    role: UserRole.INSTRUCTOR,
  },
  {
    id: '88888888-8888-4888-8888-888888888888',
    email: 'student@example.com',
    firstName: 'Olena',
    lastName: 'Koval',
    role: UserRole.STUDENT,
  },
] as const;

/**
 * Demo logins exist only off production.
 * NODE_ENV=production always wins, so a copied SEED_DEMO_USERS=true cannot create them on prod.
 * Development turns them on so the frontend can sign in without cloning this repo.
 * Any other environment needs an explicit SEED_DEMO_USERS=true.
 */
export function shouldProvisionDemoAccounts(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const nodeEnv = (env.NODE_ENV ?? '').trim().toLowerCase();
  if (nodeEnv === 'production') {
    return false;
  }

  const flag = (env.SEED_DEMO_USERS ?? '').trim().toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'no') {
    return false;
  }
  if (flag === 'true' || flag === '1' || flag === 'yes') {
    return true;
  }

  return nodeEnv === 'development';
}

export async function ensureDemoAccountsIfEnabled(
  db: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[] | null> {
  if (!shouldProvisionDemoAccounts(env)) {
    return null;
  }
  return provisionDemoAccounts(db);
}

export async function provisionDemoAccounts(
  db: PrismaClient,
): Promise<string[]> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const organization = await ensureDemoOrganization(db);

  for (const account of DEMO_ACCOUNTS) {
    const user = await db.user.upsert({
      where: { email: account.email },
      update: {
        passwordHash,
        firstName: account.firstName,
        lastName: account.lastName,
        role: account.role,
        status: UserStatus.ACTIVE,
        organizationId: organization.id,
        deletedAt: null,
      },
      create: {
        id: account.id,
        email: account.email,
        passwordHash,
        firstName: account.firstName,
        lastName: account.lastName,
        role: account.role,
        status: UserStatus.ACTIVE,
        organizationId: organization.id,
      },
    });

    if (account.role !== UserRole.STUDENT) {
      continue;
    }

    const profile = await db.student.findUnique({
      where: { userId: user.id },
    });
    if (profile) {
      continue;
    }

    await db.student.create({
      data: {
        userId: user.id,
        organizationId: organization.id,
        category: LicenseCategory.B,
        transmission: Transmission.MANUAL,
        trainingStatus: TrainingStatus.ACTIVE,
      },
    });
  }

  await ensureDemoCars(db, organization.id);

  return DEMO_ACCOUNTS.map((account) => account.email);
}

async function ensureDemoOrganization(db: PrismaClient) {
  const existing =
    (await db.organization.findUnique({
      where: { email: DEMO_ORG_EMAIL },
    })) ??
    (await db.organization.findUnique({
      where: { slug: DEMO_ORG_SLUG },
    })) ??
    (await db.organization.findUnique({
      where: { id: DEMO_ORG_ID },
    }));

  if (!existing) {
    return db.organization.create({
      data: {
        id: DEMO_ORG_ID,
        name: DEMO_ORG_NAME,
        slug: DEMO_ORG_SLUG,
        email: DEMO_ORG_EMAIL,
        timezone: 'Europe/Kyiv',
      },
    });
  }

  if (existing.deletedAt || existing.status !== OrganizationStatus.ACTIVE) {
    return db.organization.update({
      where: { id: existing.id },
      data: {
        status: OrganizationStatus.ACTIVE,
        deletedAt: null,
      },
    });
  }

  return existing;
}

async function ensureDemoCars(db: PrismaClient, organizationId: string) {
  const instructor = await db.user.findFirst({
    where: {
      id: DEMO_INSTRUCTOR_ID,
      organizationId,
      role: UserRole.INSTRUCTOR,
      deletedAt: null,
    },
  });
  if (!instructor) {
    return;
  }

  const cars = [
    {
      id: DEMO_CAR_MANUAL_ID,
      plateNumber: 'AA0001BB',
      category: LicenseCategory.B,
      transmission: Transmission.MANUAL,
    },
    {
      id: DEMO_CAR_AUTOMATIC_ID,
      plateNumber: 'AA0002BB',
      category: LicenseCategory.B,
      transmission: Transmission.AUTOMATIC,
    },
  ] as const;

  for (const car of cars) {
    await db.car.upsert({
      where: { id: car.id },
      update: {
        organizationId,
        instructorId: instructor.id,
        plateNumber: car.plateNumber,
        category: car.category,
        transmission: car.transmission,
      },
      create: {
        id: car.id,
        organizationId,
        instructorId: instructor.id,
        plateNumber: car.plateNumber,
        category: car.category,
        transmission: car.transmission,
      },
    });
  }
}
