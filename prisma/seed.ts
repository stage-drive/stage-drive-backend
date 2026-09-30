import { createHash } from 'crypto';
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  EnrollmentStatus,
  GroupStatus,
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
const DEMO_ARCHIVED_ID = '55555555-5555-4555-8555-555555555555';
const DEMO_ADMIN_ID = '66666666-6666-6666-6666-666666666666';
const DEMO_INVITATION_ID = '77777777-7777-7777-7777-777777777777';
const DEMO_STUDENT_ID = '88888888-8888-4888-8888-888888888888';
const DEMO_STUDENT_PROFILE_ID = '99999999-9999-4999-8999-999999999999';
const DEMO_OTHER_ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEMO_OTHER_STUDENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DEMO_OTHER_STUDENT_PROFILE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DEMO_GROUP_ACTIVE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DEMO_GROUP_SECOND_ID = 'cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd';
const DEMO_GROUP_COMPLETED_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const DEMO_GROUP_ARCHIVED_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const DEMO_OTHER_GROUP_ID = 'abababab-abab-4bab-8bab-abababababab';
const DEMO_GROUPED_STUDENT_ID = '13131313-1313-4131-8131-131313131313';
const DEMO_GROUPED_PROFILE_ID = '14141414-1414-4141-8141-141414141414';
const DEMO_DROPPED_STUDENT_ID = '15151515-1515-4151-8151-151515151515';
const DEMO_DROPPED_PROFILE_ID = '16161616-1616-4161-8161-161616161616';
const DEMO_GRADUATED_STUDENT_ID = '17171717-1717-4171-8171-171717171717';
const DEMO_GRADUATED_PROFILE_ID = '18181818-1818-4181-8181-181818181818';
const DEMO_ARCHIVED_PROFILE_ID = '19191919-1919-4191-8191-191919191919';
const DEMO_GROUPED_EMAIL = 'grouped-student@example.com';
const DEMO_DROPPED_EMAIL = 'dropped-student@example.com';
const DEMO_GRADUATED_EMAIL = 'graduated-student@example.com';

const DEMO_EMAIL = 'owner@example.com';
const DEMO_ADMIN_EMAIL = 'admin@example.com';
const DEMO_INVITED_EMAIL = 'invited@example.com';
const DEMO_BLOCKED_EMAIL = 'blocked@example.com';
const DEMO_ARCHIVED_EMAIL = 'archived@example.com';
const DEMO_STUDENT_EMAIL = 'student@example.com';
const DEMO_OTHER_ORG_EMAIL = 'other-school@example.com';
const DEMO_OTHER_STUDENT_EMAIL = 'foreign-student@example.com';
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

async function upsertOrganizationByEmail(input: {
  id: string;
  name: string;
  slug: string;
  email: string;
}) {
  const existing =
    (await prisma.organization.findUnique({ where: { email: input.email } })) ??
    (await prisma.organization.findUnique({ where: { slug: input.slug } })) ??
    (await prisma.organization.findUnique({ where: { id: input.id } }));

  if (existing) {
    return prisma.organization.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        status: OrganizationStatus.ACTIVE,
        deletedAt: null,
      },
    });
  }

  return prisma.organization.create({
    data: {
      id: input.id,
      name: input.name,
      slug: input.slug,
      email: input.email,
      timezone: 'Europe/Kyiv',
    },
  });
}

async function upsertStudentProfile(
  profileId: string,
  userId: string,
  organizationId: string,
  groupId: string | null = null,
) {
  return prisma.student.upsert({
    where: { userId },
    update: { organizationId, groupId },
    create: {
      id: profileId,
      userId,
      organizationId,
      groupId,
      instructorId: null,
      carId: null,
    },
  });
}

async function upsertGroup(input: {
  id: string;
  name: string;
  status: GroupStatus;
  organizationId: string;
  teacherId: string;
}) {
  return prisma.group.upsert({
    where: { id: input.id },
    update: {
      name: input.name,
      status: input.status,
      organizationId: input.organizationId,
      teacherId: input.teacherId,
    },
    create: input,
  });
}

async function upsertEnrollment(
  groupId: string,
  studentId: string,
  status: EnrollmentStatus,
) {
  return prisma.enrollment.upsert({
    where: { groupId_studentId: { groupId, studentId } },
    update: { status },
    create: { groupId, studentId, status },
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

  const archivedUser = await upsertUser(organization.id, {
    id: DEMO_ARCHIVED_ID,
    email: DEMO_ARCHIVED_EMAIL,
    firstName: 'Anna',
    lastName: 'Archived',
    role: UserRole.STUDENT,
    status: UserStatus.ARCHIVED,
    passwordHash,
  });
  const archived =
    archivedUser.id === DEMO_ARCHIVED_ID
      ? archivedUser
      : await prisma.user.update({
          where: { id: archivedUser.id },
          data: { id: DEMO_ARCHIVED_ID },
        });

  const activeStudent = await upsertUser(organization.id, {
    id: DEMO_STUDENT_ID,
    email: DEMO_STUDENT_EMAIL,
    firstName: 'Olena',
    lastName: 'Koval',
    role: UserRole.STUDENT,
    status: UserStatus.ACTIVE,
    passwordHash,
  });
  await prisma.user.update({
    where: { id: activeStudent.id },
    data: { phone: '+380671112233' },
  });
  await upsertStudentProfile(
    DEMO_STUDENT_PROFILE_ID,
    activeStudent.id,
    organization.id,
  );
  await prisma.enrollment.deleteMany({
    where: { studentId: activeStudent.id },
  });

  const otherOrganization = await upsertOrganizationByEmail({
    id: DEMO_OTHER_ORG_ID,
    name: 'Other School',
    slug: 'other-school',
    email: DEMO_OTHER_ORG_EMAIL,
  });
  const foreignStudent = await upsertUser(otherOrganization.id, {
    id: DEMO_OTHER_STUDENT_ID,
    email: DEMO_OTHER_STUDENT_EMAIL,
    firstName: 'Foreign',
    lastName: 'Student',
    role: UserRole.STUDENT,
    status: UserStatus.ACTIVE,
    passwordHash,
  });
  await upsertStudentProfile(
    DEMO_OTHER_STUDENT_PROFILE_ID,
    foreignStudent.id,
    otherOrganization.id,
  );

  const activeGroup = await upsertGroup({
    id: DEMO_GROUP_ACTIVE_ID,
    name: 'Група A — активна',
    status: GroupStatus.ACTIVE,
    organizationId: organization.id,
    teacherId: invited.id,
  });
  const secondGroup = await upsertGroup({
    id: DEMO_GROUP_SECOND_ID,
    name: 'Група B — активна',
    status: GroupStatus.ACTIVE,
    organizationId: organization.id,
    teacherId: invited.id,
  });
  const completedGroup = await upsertGroup({
    id: DEMO_GROUP_COMPLETED_ID,
    name: 'Група C — завершена',
    status: GroupStatus.COMPLETED,
    organizationId: organization.id,
    teacherId: invited.id,
  });
  const archivedGroup = await upsertGroup({
    id: DEMO_GROUP_ARCHIVED_ID,
    name: 'Група D — архів',
    status: GroupStatus.ARCHIVED,
    organizationId: organization.id,
    teacherId: invited.id,
  });
  const foreignGroup = await upsertGroup({
    id: DEMO_OTHER_GROUP_ID,
    name: 'Чужа група',
    status: GroupStatus.ACTIVE,
    organizationId: otherOrganization.id,
    teacherId: foreignStudent.id,
  });

  const groupedStudent = await upsertUser(organization.id, {
    id: DEMO_GROUPED_STUDENT_ID,
    email: DEMO_GROUPED_EMAIL,
    firstName: 'Iryna',
    lastName: 'Grouped',
    role: UserRole.STUDENT,
    status: UserStatus.ACTIVE,
    passwordHash,
  });
  const droppedStudent = await upsertUser(organization.id, {
    id: DEMO_DROPPED_STUDENT_ID,
    email: DEMO_DROPPED_EMAIL,
    firstName: 'Pavlo',
    lastName: 'Dropped',
    role: UserRole.STUDENT,
    status: UserStatus.ACTIVE,
    passwordHash,
  });
  const graduatedStudent = await upsertUser(organization.id, {
    id: DEMO_GRADUATED_STUDENT_ID,
    email: DEMO_GRADUATED_EMAIL,
    firstName: 'Nadia',
    lastName: 'Graduated',
    role: UserRole.STUDENT,
    status: UserStatus.ACTIVE,
    passwordHash,
  });

  await upsertStudentProfile(
    DEMO_ARCHIVED_PROFILE_ID,
    archived.id,
    organization.id,
  );
  await upsertStudentProfile(
    DEMO_GROUPED_PROFILE_ID,
    groupedStudent.id,
    organization.id,
    activeGroup.id,
  );
  await upsertStudentProfile(
    DEMO_DROPPED_PROFILE_ID,
    droppedStudent.id,
    organization.id,
  );
  await upsertStudentProfile(
    DEMO_GRADUATED_PROFILE_ID,
    graduatedStudent.id,
    organization.id,
  );

  await upsertEnrollment(
    activeGroup.id,
    groupedStudent.id,
    EnrollmentStatus.ACTIVE,
  );
  await upsertEnrollment(
    activeGroup.id,
    droppedStudent.id,
    EnrollmentStatus.DROPPED,
  );
  await upsertEnrollment(
    completedGroup.id,
    graduatedStudent.id,
    EnrollmentStatus.COMPLETED,
  );

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
  console.log(`  ACTIVE student:  ${DEMO_STUDENT_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  student card id (no group): ${activeStudent.id}`);
  console.log(
    `  student already in group A: ${DEMO_GROUPED_EMAIL} / ${DEMO_PASSWORD} id=${groupedStudent.id}`,
  );
  console.log(
    `  DROPPED student: ${DEMO_DROPPED_EMAIL} id=${droppedStudent.id}`,
  );
  console.log(
    `  GRADUATED student: ${DEMO_GRADUATED_EMAIL} id=${graduatedStudent.id}`,
  );
  console.log(`  ARCHIVED student id: ${archived.id}`);
  console.log(
    `  other-org student id (expect 404 for Stage Drive admin): ${foreignStudent.id}`,
  );
  console.log(`  group A ACTIVE:    ${activeGroup.id}`);
  console.log(`  group B ACTIVE:    ${secondGroup.id}`);
  console.log(`  group C COMPLETED: ${completedGroup.id}`);
  console.log(`  group D ARCHIVED:  ${archivedGroup.id}`);
  console.log(`  other-org group:   ${foreignGroup.id}`);
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
