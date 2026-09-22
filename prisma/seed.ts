import { createHash } from 'crypto';
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  InvitationStatus,
  OrganizationStatus,
  PrismaClient,
  UserRole,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { requireEnv } from '../src/common/config/env';

const DATABASE_URL = requireEnv('DATABASE_URL');

const DEMO_ORG_ID = '11111111-1111-1111-1111-111111111111';
const DEMO_USER_ID = '22222222-2222-2222-2222-222222222222';
const DEMO_INVITED_ID = '33333333-3333-3333-3333-333333333333';
const DEMO_BLOCKED_ID = '44444444-4444-4444-4444-444444444444';
const DEMO_ARCHIVED_ID = '55555555-5555-5555-5555-555555555555';
const DEMO_ADMIN_ID = '66666666-6666-6666-6666-666666666666';
const DEMO_INVITATION_ID = '77777777-7777-7777-7777-777777777777';

const DEMO_EMAIL = 'owner@example.com';
const DEMO_ADMIN_EMAIL = 'admin@example.com';
const DEMO_INVITED_EMAIL = 'invited@example.com';
const DEMO_BLOCKED_EMAIL = 'blocked@example.com';
const DEMO_ARCHIVED_EMAIL = 'archived@example.com';
const DEMO_PASSWORD = 'Password1';

/** Real Gmail of the person who tests POST /api/auth/google. Must match the Google idToken email. */
const SEED_GOOGLE_EMAIL = (process.env.SEED_GOOGLE_EMAIL ?? '')
  .trim()
  .toLowerCase();

/** Known invitation token for Postman (`POST /api/invitations/verify`). 64 chars. */
const DEMO_INVITE_TOKEN =
  'SEED_INVITE_TOKEN_FOR_LOCAL_POSTMAN_ONLY___________00000000001';
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function upsertOrganization() {
  const existing =
    (await prisma.organization.findUnique({
      where: { email: DEMO_EMAIL },
    })) ??
    (await prisma.organization.findUnique({
      where: { id: DEMO_ORG_ID },
    }));

  if (existing) {
    return prisma.organization.update({
      where: { id: existing.id },
      data: {
        name: 'Stage Drive School',
        status: OrganizationStatus.ACTIVE,
        deletedAt: null,
      },
    });
  }

  return prisma.organization.create({
    data: {
      id: DEMO_ORG_ID,
      name: 'Stage Drive School',
      slug: 'stage-drive-school',
      email: DEMO_EMAIL,
      timezone: 'Europe/Kyiv',
    },
  });
}

async function upsertUser(
  organizationId: string,
  input: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    status: UserStatus;
    passwordHash: string | null;
  },
) {
  return prisma.user.upsert({
    where: { email: input.email },
    update: {
      passwordHash: input.passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
      status: input.status,
      organizationId,
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
      organizationId,
    },
  });
}

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const organization = await upsertOrganization();

  const owner = await upsertUser(organization.id, {
    id: DEMO_USER_ID,
    email: DEMO_EMAIL,
    firstName: 'Ivan',
    lastName: 'Petrenko',
    role: UserRole.OWNER,
    status: UserStatus.ACTIVE,
    passwordHash,
  });

  await upsertUser(organization.id, {
    id: DEMO_ADMIN_ID,
    email: DEMO_ADMIN_EMAIL,
    firstName: 'Maria',
    lastName: 'Ivanenko',
    role: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
    passwordHash,
  });

  const invited = await upsertUser(organization.id, {
    id: DEMO_INVITED_ID,
    email: DEMO_INVITED_EMAIL,
    firstName: 'Olena',
    lastName: 'Koval',
    role: UserRole.TEACHER,
    status: UserStatus.INVITED,
    passwordHash: null,
  });

  await upsertUser(organization.id, {
    id: DEMO_BLOCKED_ID,
    email: DEMO_BLOCKED_EMAIL,
    firstName: 'Petro',
    lastName: 'Blocked',
    role: UserRole.STUDENT,
    status: UserStatus.BLOCKED,
    passwordHash,
  });

  await upsertUser(organization.id, {
    id: DEMO_ARCHIVED_ID,
    email: DEMO_ARCHIVED_EMAIL,
    firstName: 'Anna',
    lastName: 'Archived',
    role: UserRole.STUDENT,
    status: UserStatus.ARCHIVED,
    passwordHash,
  });

  const tokenHash = hashToken(DEMO_INVITE_TOKEN);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  await prisma.invitation.deleteMany({
    where: {
      OR: [
        { id: DEMO_INVITATION_ID },
        { tokenHash },
        { email: DEMO_INVITED_EMAIL },
      ],
    },
  });

  await prisma.invitation.create({
    data: {
      id: DEMO_INVITATION_ID,
      email: DEMO_INVITED_EMAIL,
      role: UserRole.TEACHER,
      tokenHash,
      status: InvitationStatus.PENDING,
      expiresAt,
      invitedById: owner.id,
      userId: invited.id,
      organizationId: organization.id,
    },
  });

  console.log('Seed users for Postman (password login, not Google OAuth):');
  console.log(`  ACTIVE owner:    ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  ACTIVE admin:    ${DEMO_ADMIN_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(
    `  INVITED teacher: ${DEMO_INVITED_EMAIL} (no password; verify token below)`,
  );
  console.log(`  BLOCKED student: ${DEMO_BLOCKED_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  ARCHIVED student: ${DEMO_ARCHIVED_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(
    `Invitation token (POST /api/invitations/verify and /activate): ${DEMO_INVITE_TOKEN}`,
  );

  if (!SEED_GOOGLE_EMAIL) {
    console.log(
      'SEED_GOOGLE_EMAIL is empty — Google QA user skipped. Set it to the tester Gmail and re-run seed.',
    );
    return;
  }

  const googleQa = await prisma.user.findUnique({
    where: { email: SEED_GOOGLE_EMAIL },
  });

  if (googleQa) {
    await prisma.user.update({
      where: { id: googleQa.id },
      data: {
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
    });
    console.log(
      `Google QA user ready (existing ${googleQa.role}): ${SEED_GOOGLE_EMAIL} status=ACTIVE`,
    );
  } else {
    await prisma.user.create({
      data: {
        email: SEED_GOOGLE_EMAIL,
        firstName: 'QA',
        lastName: 'Google',
        role: UserRole.TEACHER,
        status: UserStatus.ACTIVE,
        passwordHash,
        organizationId: organization.id,
      },
    });
    console.log(
      `Google QA user created: ${SEED_GOOGLE_EMAIL} / ${DEMO_PASSWORD} (ACTIVE TEACHER)`,
    );
  }
  console.log(
    'POST /api/auth/google — Body { "idToken": "<Google id_token>" }, Authorization: No Auth.',
  );
  console.log(
    'Flip users.status in Prisma Studio for INVITED / BLOCKED / ARCHIVED on this same email.',
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
