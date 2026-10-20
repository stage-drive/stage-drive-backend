import { createHash } from 'crypto';
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  CarStatus,
  CourseMaterialType,
  CourseStatus,
  EnrollmentStatus,
  GroupStatus,
  InvitationStatus,
  LicenseCategory,
  OrganizationStatus,
  PrismaClient,
  TrainingStatus,
  Transmission,
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
const DEMO_COURSE_B_ID = '41414141-4141-4414-8414-414141414141';
const DEMO_COURSE_A_ID = '42424242-4242-4424-8424-424242424242';
const DEMO_COURSE_ARCHIVED_ID = '43434343-4343-4434-8434-434343434343';
const DEMO_OTHER_COURSE_ID = '45454545-4545-4454-8454-454545454545';
const DEMO_CHAPTER_TRAFFIC_ID = '51515151-5151-4515-8515-515151515151';
const DEMO_CHAPTER_CAR_ID = '52525252-5252-4525-8525-525252525252';
const DEMO_OTHER_CHAPTER_ID = '53535353-5353-4535-8535-535353535353';
const DEMO_LESSON_SIGNS_ID = '61616161-6161-4616-8616-616161616161';
const DEMO_LESSON_CONTROL_ID = '62626262-6262-4626-8626-626262626262';
const DEMO_LESSON_ENGINE_ID = '63636363-6363-4636-8636-636363636363';
const DEMO_MATERIAL_SIGNS_TEXT_ID = '71717171-7171-4717-8717-717171717171';
const DEMO_MATERIAL_SIGNS_LINK_ID = '72727272-7272-4727-8727-727272727272';
const DEMO_MATERIAL_CONTROL_VIDEO_ID = '73737373-7373-4737-8737-737373737373';
const DEMO_MATERIAL_ENGINE_TEXT_ID = '74747474-7474-4747-8747-747474747474';
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
const DEMO_INSTRUCTOR_ID = '23232323-2323-4232-8232-232323232323';
const DEMO_INSTRUCTOR_EMAIL = 'instructor@example.com';
const DEMO_INSTRUCTOR_2_ID = '24242424-2424-4242-8242-242424242424';
const DEMO_INSTRUCTOR_2_EMAIL = 'instructor2@example.com';
const DEMO_BLOCKED_INSTRUCTOR_ID = '25252525-2525-4252-8252-252525252525';
const DEMO_BLOCKED_INSTRUCTOR_EMAIL = 'instructor-blocked@example.com';
const DEMO_OTHER_INSTRUCTOR_ID = '26262626-2626-4262-8262-262626262626';
const DEMO_OTHER_INSTRUCTOR_EMAIL = 'foreign-instructor@example.com';
const DEMO_CAR_MATCH_ID = '31313131-3131-4131-8131-313131313131';
const DEMO_CAR_AUTO_ID = '32323232-3232-4232-8232-323232323232';
const DEMO_CAR_CATEGORY_ID = '34343434-3434-4343-8343-343434343434';
const DEMO_CAR_OTHER_INSTRUCTOR_ID = '35353535-3535-4353-8353-353535353535';
const DEMO_CAR_OTHER_ORG_ID = '36363636-3636-4363-8363-363636363636';
const DEMO_CAR_MAINTENANCE_ID = '38383838-3838-4383-8383-383838383838';
const DEMO_CAR_INACTIVE_ID = '39393939-3939-4393-8393-393939393939';
const DEMO_CAR_UNASSIGNED_ID = '3a3a3a3a-3a3a-43a3-83a3-3a3a3a3a3a3a';

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
  // Fallback на фіксований id: demo-юзер міг змінити email через /users/me/email/*,
  // і upsert лише за email спробував би створити рядок із тим самим id (P2002).
  // Так само робить provisionDemoAccounts у src/prisma/demo-accounts.ts.
  const byEmail = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  return prisma.user.upsert({
    where: { id: byEmail?.id ?? input.id },
    update: {
      email: input.email,
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
  trainingStatus: TrainingStatus = TrainingStatus.ACTIVE,
) {
  return prisma.student.upsert({
    where: { userId },
    update: {
      organizationId,
      groupId,
      trainingStatus,
      category: LicenseCategory.B,
      transmission: Transmission.MANUAL,
      instructorId: null,
      carId: null,
    },
    create: {
      id: profileId,
      userId,
      organizationId,
      groupId,
      instructorId: null,
      carId: null,
      category: LicenseCategory.B,
      transmission: Transmission.MANUAL,
      trainingStatus,
    },
  });
}

async function upsertGroup(input: {
  id: string;
  name: string;
  status: GroupStatus;
  organizationId: string;
  teacherId: string;
  courseId?: string | null;
}) {
  const courseId = input.courseId ?? null;
  return prisma.group.upsert({
    where: { id: input.id },
    update: {
      name: input.name,
      status: input.status,
      organizationId: input.organizationId,
      teacherId: input.teacherId,
      courseId,
    },
    create: { ...input, courseId },
  });
}

async function upsertCourse(input: {
  id: string;
  name: string;
  status: CourseStatus;
  organizationId: string;
  description?: string;
}) {
  const description = input.description ?? null;
  return prisma.course.upsert({
    where: { id: input.id },
    update: {
      name: input.name,
      status: input.status,
      organizationId: input.organizationId,
      description,
    },
    create: { ...input, description },
  });
}

async function upsertChapter(input: {
  id: string;
  courseId: string;
  title: string;
  description?: string | null;
  position: number;
}) {
  const description = input.description ?? null;
  return prisma.courseChapter.upsert({
    where: { id: input.id },
    update: {
      courseId: input.courseId,
      title: input.title,
      description,
      position: input.position,
    },
    create: { ...input, description },
  });
}

async function upsertLesson(input: {
  id: string;
  courseId: string;
  chapterId: string;
  title: string;
  description?: string | null;
  position: number;
}) {
  const description = input.description ?? null;
  return prisma.courseLesson.upsert({
    where: { id: input.id },
    update: {
      courseId: input.courseId,
      chapterId: input.chapterId,
      title: input.title,
      description,
      position: input.position,
    },
    create: { ...input, description },
  });
}

async function upsertMaterial(input: {
  id: string;
  courseId: string;
  lessonId: string;
  title: string;
  type: CourseMaterialType;
  body?: string | null;
  position: number;
}) {
  const body = input.body ?? null;
  return prisma.courseMaterial.upsert({
    where: { id: input.id },
    update: {
      courseId: input.courseId,
      lessonId: input.lessonId,
      title: input.title,
      type: input.type,
      body,
      position: input.position,
    },
    create: { ...input, body },
  });
}

async function upsertCar(input: {
  id: string;
  organizationId: string;
  instructorId: string | null;
  plateNumber: string;
  category: LicenseCategory;
  transmission: Transmission;
  status?: CarStatus;
}) {
  const status = input.status ?? CarStatus.AVAILABLE;
  return prisma.car.upsert({
    where: { id: input.id },
    update: {
      organizationId: input.organizationId,
      instructorId: input.instructorId,
      plateNumber: input.plateNumber,
      category: input.category,
      transmission: input.transmission,
      status,
    },
    create: {
      id: input.id,
      organizationId: input.organizationId,
      instructorId: input.instructorId,
      plateNumber: input.plateNumber,
      category: input.category,
      transmission: input.transmission,
      status,
    },
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

  const courseB = await upsertCourse({
    id: DEMO_COURSE_B_ID,
    name: 'Теоретичний курс, категорія B',
    status: CourseStatus.ACTIVE,
    organizationId: organization.id,
    description: 'ПДР, основи безпеки руху та будова автомобіля.',
  });
  const courseA = await upsertCourse({
    id: DEMO_COURSE_A_ID,
    name: 'Теоретичний курс, категорія A',
    status: CourseStatus.ACTIVE,
    organizationId: organization.id,
  });
  const archivedCourse = await upsertCourse({
    id: DEMO_COURSE_ARCHIVED_ID,
    name: 'Старий курс (архів)',
    status: CourseStatus.ARCHIVED,
    organizationId: organization.id,
  });
  const foreignCourse = await upsertCourse({
    id: DEMO_OTHER_COURSE_ID,
    name: 'Курс іншої автошколи',
    status: CourseStatus.ACTIVE,
    organizationId: otherOrganization.id,
  });

  await upsertChapter({
    id: DEMO_CHAPTER_TRAFFIC_ID,
    courseId: courseB.id,
    title: 'Правила дорожнього руху',
    description: 'Знаки, розмітка та регулювання.',
    position: 1,
  });
  await upsertChapter({
    id: DEMO_CHAPTER_CAR_ID,
    courseId: courseB.id,
    title: 'Будова автомобіля',
    description: 'Двигун, трансмісія та ходова частина.',
    position: 2,
  });
  await upsertChapter({
    id: DEMO_OTHER_CHAPTER_ID,
    courseId: foreignCourse.id,
    title: 'Розділ іншої автошколи',
    position: 1,
  });
  await upsertLesson({
    id: DEMO_LESSON_SIGNS_ID,
    courseId: courseB.id,
    chapterId: DEMO_CHAPTER_TRAFFIC_ID,
    title: 'Дорожні знаки',
    description: 'Огляд груп знаків.',
    position: 1,
  });
  await upsertLesson({
    id: DEMO_LESSON_CONTROL_ID,
    courseId: courseB.id,
    chapterId: DEMO_CHAPTER_TRAFFIC_ID,
    title: 'Регулювання руху',
    position: 2,
  });
  await upsertLesson({
    id: DEMO_LESSON_ENGINE_ID,
    courseId: courseB.id,
    chapterId: DEMO_CHAPTER_CAR_ID,
    title: 'Двигун',
    position: 1,
  });
  await upsertMaterial({
    id: DEMO_MATERIAL_SIGNS_TEXT_ID,
    courseId: courseB.id,
    lessonId: DEMO_LESSON_SIGNS_ID,
    title: 'Групи дорожніх знаків',
    type: CourseMaterialType.TEXT,
    body: 'Попереджувальні, пріоритету, заборонні, наказові, інформаційні.',
    position: 1,
  });
  await upsertMaterial({
    id: DEMO_MATERIAL_SIGNS_LINK_ID,
    courseId: courseB.id,
    lessonId: DEMO_LESSON_SIGNS_ID,
    title: 'Офіційні ПДР',
    type: CourseMaterialType.LINK,
    body: 'https://zakon.rada.gov.ua/laws/show/1306-2001-%D0%BF',
    position: 2,
  });
  await upsertMaterial({
    id: DEMO_MATERIAL_CONTROL_VIDEO_ID,
    courseId: courseB.id,
    lessonId: DEMO_LESSON_CONTROL_ID,
    title: 'Регулювальник',
    type: CourseMaterialType.VIDEO,
    body: 'https://example.com/video/traffic-control',
    position: 1,
  });
  await upsertMaterial({
    id: DEMO_MATERIAL_ENGINE_TEXT_ID,
    courseId: courseB.id,
    lessonId: DEMO_LESSON_ENGINE_ID,
    title: 'Призначення двигуна',
    type: CourseMaterialType.TEXT,
    body: 'Двигун перетворює енергію палива на механічну роботу.',
    position: 1,
  });

  const activeGroup = await upsertGroup({
    id: DEMO_GROUP_ACTIVE_ID,
    name: 'Група A — активна',
    status: GroupStatus.ACTIVE,
    organizationId: organization.id,
    teacherId: invited.id,
    courseId: courseB.id,
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
    null,
    TrainingStatus.ARCHIVED,
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
    null,
    TrainingStatus.DROPPED,
  );
  await upsertStudentProfile(
    DEMO_GRADUATED_PROFILE_ID,
    graduatedStudent.id,
    organization.id,
    null,
    TrainingStatus.GRADUATED,
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

  const instructor = await upsertUser(organization.id, {
    id: DEMO_INSTRUCTOR_ID,
    email: DEMO_INSTRUCTOR_EMAIL,
    firstName: 'Taras',
    lastName: 'Shevchenko',
    role: UserRole.INSTRUCTOR,
    status: UserStatus.ACTIVE,
    passwordHash,
  });
  const secondInstructor = await upsertUser(organization.id, {
    id: DEMO_INSTRUCTOR_2_ID,
    email: DEMO_INSTRUCTOR_2_EMAIL,
    firstName: 'Bohdan',
    lastName: 'Kovalenko',
    role: UserRole.INSTRUCTOR,
    status: UserStatus.ACTIVE,
    passwordHash,
  });
  const blockedInstructor = await upsertUser(organization.id, {
    id: DEMO_BLOCKED_INSTRUCTOR_ID,
    email: DEMO_BLOCKED_INSTRUCTOR_EMAIL,
    firstName: 'Ivan',
    lastName: 'BlockedInstructor',
    role: UserRole.INSTRUCTOR,
    status: UserStatus.BLOCKED,
    passwordHash,
  });
  const foreignInstructor = await upsertUser(otherOrganization.id, {
    id: DEMO_OTHER_INSTRUCTOR_ID,
    email: DEMO_OTHER_INSTRUCTOR_EMAIL,
    firstName: 'Foreign',
    lastName: 'Instructor',
    role: UserRole.INSTRUCTOR,
    status: UserStatus.ACTIVE,
    passwordHash,
  });

  const matchingCar = await upsertCar({
    id: DEMO_CAR_MATCH_ID,
    organizationId: organization.id,
    instructorId: instructor.id,
    plateNumber: 'AA0001BB',
    category: LicenseCategory.B,
    transmission: Transmission.MANUAL,
  });
  const automaticCar = await upsertCar({
    id: DEMO_CAR_AUTO_ID,
    organizationId: organization.id,
    instructorId: instructor.id,
    plateNumber: 'AA0002BB',
    category: LicenseCategory.B,
    transmission: Transmission.AUTOMATIC,
  });
  const categoryCar = await upsertCar({
    id: DEMO_CAR_CATEGORY_ID,
    organizationId: organization.id,
    instructorId: instructor.id,
    plateNumber: 'AA0003BB',
    category: LicenseCategory.C,
    transmission: Transmission.MANUAL,
  });
  const otherInstructorCar = await upsertCar({
    id: DEMO_CAR_OTHER_INSTRUCTOR_ID,
    organizationId: organization.id,
    instructorId: secondInstructor.id,
    plateNumber: 'AA0004BB',
    category: LicenseCategory.B,
    transmission: Transmission.MANUAL,
  });
  const foreignCar = await upsertCar({
    id: DEMO_CAR_OTHER_ORG_ID,
    organizationId: otherOrganization.id,
    instructorId: foreignInstructor.id,
    plateNumber: 'AA0005BB',
    category: LicenseCategory.B,
    transmission: Transmission.MANUAL,
  });
  const maintenanceCar = await upsertCar({
    id: DEMO_CAR_MAINTENANCE_ID,
    organizationId: organization.id,
    instructorId: instructor.id,
    plateNumber: 'AA0006BB',
    category: LicenseCategory.B,
    transmission: Transmission.MANUAL,
    status: CarStatus.MAINTENANCE,
  });
  const inactiveCar = await upsertCar({
    id: DEMO_CAR_INACTIVE_ID,
    organizationId: organization.id,
    instructorId: instructor.id,
    plateNumber: 'AA0009BB',
    category: LicenseCategory.B,
    transmission: Transmission.MANUAL,
    status: CarStatus.INACTIVE,
  });
  const unassignedCar = await upsertCar({
    id: DEMO_CAR_UNASSIGNED_ID,
    organizationId: organization.id,
    instructorId: null,
    plateNumber: 'AA0008BB',
    category: LicenseCategory.B,
    transmission: Transmission.MANUAL,
    status: CarStatus.AVAILABLE,
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
    'PATCH /api/students/{id}/status — only ADMIN. Example body: { "status": "GRADUATED" }.',
  );
  console.log(
    `  other-org student id (expect 404 for Stage Drive admin): ${foreignStudent.id}`,
  );
  console.log(`  group A ACTIVE:    ${activeGroup.id}`);
  console.log(`  group B ACTIVE:    ${secondGroup.id}`);
  console.log(`  group C COMPLETED: ${completedGroup.id}`);
  console.log(`  group D ARCHIVED:  ${archivedGroup.id}`);
  console.log(`  other-org group:   ${foreignGroup.id}`);
  console.log(`  course B ACTIVE (assigned to group A): ${courseB.id}`);
  console.log(`  course A ACTIVE:   ${courseA.id}`);
  console.log(`  course ARCHIVED (expect 409): ${archivedCourse.id}`);
  console.log(`  other-org course (expect 404): ${foreignCourse.id}`);
  console.log(`  chapter ПДР: ${DEMO_CHAPTER_TRAFFIC_ID}`);
  console.log(`  chapter будова: ${DEMO_CHAPTER_CAR_ID}`);
  console.log(`  other-org chapter (expect 404): ${DEMO_OTHER_CHAPTER_ID}`);
  console.log(`  lesson знаки: ${DEMO_LESSON_SIGNS_ID}`);
  console.log(`  lesson регулювання: ${DEMO_LESSON_CONTROL_ID}`);
  console.log(`  lesson двигун: ${DEMO_LESSON_ENGINE_ID}`);
  console.log(`  material text: ${DEMO_MATERIAL_SIGNS_TEXT_ID}`);
  console.log(
    'GET /api/courses/{courseId} — only ADMIN. Chapters, lessons and materials by position.',
  );
  console.log(
    'PATCH /api/groups/{id}/course — only ADMIN. Body: { "courseId": "<uuid>" } or { "courseId": null }.',
  );
  console.log(
    `  ACTIVE instructor: ${DEMO_INSTRUCTOR_EMAIL} / ${DEMO_PASSWORD} id=${instructor.id}`,
  );
  console.log(
    `  second instructor: ${DEMO_INSTRUCTOR_2_EMAIL} / ${DEMO_PASSWORD} id=${secondInstructor.id}`,
  );
  console.log(
    `  BLOCKED instructor: ${DEMO_BLOCKED_INSTRUCTOR_EMAIL} id=${blockedInstructor.id}`,
  );
  console.log(`  other-org instructor id: ${foreignInstructor.id}`);
  console.log(
    `  matching car B/MANUAL (use with student@example.com): ${matchingCar.id}`,
  );
  console.log(`  car B/AUTOMATIC (transmission mismatch): ${automaticCar.id}`);
  console.log(`  car C/MANUAL (category mismatch): ${categoryCar.id}`);
  console.log(`  car of the second instructor: ${otherInstructorCar.id}`);
  console.log(`  other-org car: ${foreignCar.id}`);
  console.log(
    `  MAINTENANCE car (assignment and practice rejected): ${maintenanceCar.id}`,
  );
  console.log(
    `  INACTIVE car (assignment and practice rejected): ${inactiveCar.id}`,
  );
  console.log(
    `  unassigned AVAILABLE car (assign via PATCH /api/cars/{id}/instructor): ${unassignedCar.id}`,
  );
  console.log(
    'PATCH /api/cars/{id}/instructor — OWNER or ADMIN. Body: { "instructorId": "<uuid>" } or { "instructorId": null }.',
  );
  console.log(
    'PATCH /api/students/{id}/practice-access — only ADMIN. Body: { "instructorId", "carId" }. Response student.car is the current car.',
  );
  console.log(
    `DELETE /api/students/{id} — OWNER or ADMIN. Archives student ${DEMO_STUDENT_EMAIL} without deleting the row. id=${activeStudent.id}`,
  );
  console.log(
    `  eligible student (ACTIVE, category B, MANUAL): ${DEMO_STUDENT_EMAIL} id=${activeStudent.id}`,
  );
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
