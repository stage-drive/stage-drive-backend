import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { requireEnv } from '../src/common/config/env';

const DATABASE_URL = requireEnv('DATABASE_URL');

const DEMO_ORG_ID = '11111111-1111-1111-1111-111111111111';
const DEMO_USER_ID = '22222222-2222-2222-2222-222222222222';
const DEMO_EMAIL = 'owner@example.com';
const DEMO_PASSWORD = 'SecurePassword123';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

async function upsertUser(input: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: UserStatus;
  passwordHash: string | null;
}) {
  await prisma.user.upsert({
    where: { email: input.email },
    update: {
      passwordHash: input.passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
      status: input.status,
      organizationId: DEMO_ORG_ID,
      deletedAt: null,
    },
    create: {
      id: input.id,
      email: input.email,
      passwordHash: input.passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
      status: input.status,
      organizationId: DEMO_ORG_ID,
    },
  });
}

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  await prisma.organization.upsert({
    where: { id: DEMO_ORG_ID },
    update: { name: 'Stage Drive School' },
    create: {
      id: DEMO_ORG_ID,
      name: 'Stage Drive School',
      slug: 'stage-drive-school',
      email: DEMO_EMAIL,
      timezone: 'Europe/Kyiv',
    },
  });

  await upsertUser({
    id: DEMO_USER_ID,
    email: DEMO_EMAIL,
    firstName: 'Ivan',
    lastName: 'Petrenko',
    role: UserRole.OWNER,
    status: UserStatus.ACTIVE,
    passwordHash,
  });

  await upsertUser({
    id: '33333333-3333-3333-3333-333333333333',
    email: 'invited@example.com',
    firstName: 'Olena',
    lastName: 'Koval',
    role: UserRole.ADMIN,
    status: UserStatus.INVITED,
    passwordHash: null,
  });

  await upsertUser({
    id: '44444444-4444-4444-4444-444444444444',
    email: 'blocked@example.com',
    firstName: 'Blocked',
    lastName: 'User',
    role: UserRole.ADMIN,
    status: UserStatus.BLOCKED,
    passwordHash,
  });

  await upsertUser({
    id: '55555555-5555-5555-5555-555555555555',
    email: 'archived@example.com',
    firstName: 'Archived',
    lastName: 'User',
    role: UserRole.ADMIN,
    status: UserStatus.ARCHIVED,
    passwordHash,
  });

  console.log(`Demo owner: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(
    'Status fixtures: invited@example.com (no password), blocked@example.com / SecurePassword123, archived@example.com / SecurePassword123',
  );
  console.log(
    'For Google login, the Google account email must match one of these users (or invite your Google email as ADMIN).',
  );
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
