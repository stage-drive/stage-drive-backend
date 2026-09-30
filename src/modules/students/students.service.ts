import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EnrollmentStatus,
  GroupStatus,
  InvitationStatus,
  LicenseCategory,
  Prisma,
  TrainingStatus,
  Transmission,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { isUniqueConstraintOn } from '../../common/prisma/unique-constraint';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EMAIL_ALREADY_EXISTS_MESSAGE,
  INVITATION_TTL_MS,
  invitationAcceptUrl,
} from '../invitations/invitations.service';
import { MailService } from '../mail/mail.service';
import {
  AssignStudentGroupDto,
  CreateStudentDto,
  CreateStudentResponseDto,
  GrantPracticeAccessDto,
  ListStudentsQueryDto,
  StudentCardDto,
  StudentListDto,
  StudentListItemDto,
  StudentSortField,
  StudentSortOrder,
  UpdateStudentDto,
  UpdateStudentTrainingStatusDto,
} from './students.dto';

export const STUDENT_LIST_ROLES = [
  UserRole.ADMIN,
  UserRole.TEACHER,
  UserRole.INSTRUCTOR,
] as const;

export const STUDENT_CREATE_ROLES = [UserRole.OWNER, UserRole.ADMIN] as const;

export const STUDENT_CARD_ROLES = [
  UserRole.OWNER,
  UserRole.ADMIN,
  UserRole.TEACHER,
  UserRole.INSTRUCTOR,
] as const;

export const STUDENT_UPDATE_ROLES = [UserRole.OWNER, UserRole.ADMIN] as const;

export const STUDENT_STATUS_ROLES = [UserRole.ADMIN] as const;

export const STUDENT_PRACTICE_ACCESS_ROLES = [UserRole.ADMIN] as const;

export const STUDENT_ARCHIVE_ROLES = [UserRole.OWNER, UserRole.ADMIN] as const;

/** Лише власний профіль. Staff-ролі цей доступ не отримують. */
export const STUDENT_SELF_ROLES = [UserRole.STUDENT] as const;

export const GROUP_NOT_FOUND_MESSAGE = 'Group not found';
export const STUDENT_NOT_FOUND_MESSAGE = 'Student not found';
export const STUDENT_TRAINING_STATUS_MESSAGE =
  'Студента зі статусом ARCHIVED, DROPPED або GRADUATED не можна призначити до групи.';
export const GROUP_NOT_ASSIGNABLE_MESSAGE =
  'Групу зі статусом ARCHIVED або COMPLETED не можна призначити.';
export const STUDENT_ACTIVE_GROUP_MESSAGE =
  'Студент уже перебуває в іншій активній групі.';
export const TRAINING_STATUS_TRANSITION_MESSAGE =
  'Недозволений перехід навчального статусу.';
export const INSTRUCTOR_NOT_FOUND_MESSAGE = 'Instructor not found';
export const CAR_NOT_FOUND_MESSAGE = 'Car not found';
export const INSTRUCTOR_ROLE_MESSAGE = 'Користувач не має ролі INSTRUCTOR.';
export const INSTRUCTOR_NOT_ACTIVE_MESSAGE =
  'Інструктор має бути в статусі ACTIVE.';
export const INSTRUCTOR_CAR_MISMATCH_MESSAGE =
  'Некоректна комбінація інструктора та автомобіля.';
export const STUDENT_PRACTICE_ACCESS_MESSAGE =
  'Студент не має права на допуск до практичного навчання.';
export const ARCHIVED_STUDENT_BOOKING_MESSAGE =
  'Архівованому студенту не можна створювати нове бронювання практики.';

const TRAINING_STATUS_TRANSITIONS: Record<
  TrainingStatus,
  readonly TrainingStatus[]
> = {
  [TrainingStatus.INVITED]: [
    TrainingStatus.ACTIVE,
    TrainingStatus.DROPPED,
    TrainingStatus.ARCHIVED,
  ],
  [TrainingStatus.ACTIVE]: [
    TrainingStatus.GRADUATED,
    TrainingStatus.DROPPED,
    TrainingStatus.ARCHIVED,
  ],
  [TrainingStatus.PRACTICE]: [
    TrainingStatus.GRADUATED,
    TrainingStatus.DROPPED,
    TrainingStatus.ARCHIVED,
  ],
  [TrainingStatus.GRADUATED]: [TrainingStatus.ARCHIVED],
  [TrainingStatus.DROPPED]: [TrainingStatus.ARCHIVED],
  [TrainingStatus.ARCHIVED]: [],
};

const TERMINAL_TRAINING_STATUSES = [
  TrainingStatus.ARCHIVED,
  TrainingStatus.DROPPED,
  TrainingStatus.GRADUATED,
] as const;

/** DROPPED — відрахований студент, COMPLETED — випуск (GRADUATED). */
const TERMINAL_ENROLLMENT_STATUSES = [
  EnrollmentStatus.DROPPED,
  EnrollmentStatus.COMPLETED,
] as const;
export const NO_STUDENT_FIELDS_MESSAGE =
  'Немає дозволених полів для оновлення (firstName, lastName, phone).';

const EMPTY_FIELD_MESSAGE = "Заповніть обов'язкове поле.";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const DEFAULT_SORT_BY: StudentSortField = 'lastName';
const DEFAULT_SORT_ORDER: StudentSortOrder = 'asc';

const studentSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  avatarUrl: true,
  role: true,
  status: true,
  organizationId: true,
  createdAt: true,
  deletedAt: true,
} satisfies Prisma.UserSelect;

type StudentRow = Prisma.UserGetPayload<{ select: typeof studentSelect }>;

const studentCardSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  avatarUrl: true,
  role: true,
  status: true,
  organizationId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  studentProfile: {
    select: {
      id: true,
      userId: true,
      organizationId: true,
      groupId: true,
      instructorId: true,
      carId: true,
      category: true,
      transmission: true,
      trainingStatus: true,
    },
  },
} satisfies Prisma.UserSelect;

type StudentCardRow = Prisma.UserGetPayload<{
  select: typeof studentCardSelect;
}>;

function contains(value: string): Prisma.StringFilter {
  return { contains: value, mode: 'insensitive' };
}

function assertCanListStudents(actor: User): void {
  if (!(STUDENT_LIST_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function assertCanCreateStudent(actor: User): void {
  if (!(STUDENT_CREATE_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function assertCanReadStudent(actor: User): void {
  if (!(STUDENT_CARD_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function assertCanUpdateStudent(actor: User): void {
  if (!(STUDENT_UPDATE_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function assertCanAssignStudentGroup(actor: User): void {
  if (!(STUDENT_UPDATE_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function assertCanChangeTrainingStatus(actor: User): void {
  if (!(STUDENT_STATUS_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function assertCanGrantPracticeAccess(actor: User): void {
  if (
    !(STUDENT_PRACTICE_ACCESS_ROLES as readonly UserRole[]).includes(actor.role)
  ) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function assertCanArchiveStudent(actor: User): void {
  if (!(STUDENT_ARCHIVE_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function assertCanReadOwnStudent(actor: User): void {
  if (!(STUDENT_SELF_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function isArchivedStudent(student: {
  status: UserStatus;
  studentProfile: { trainingStatus: TrainingStatus };
}): boolean {
  return (
    student.status === UserStatus.ARCHIVED ||
    student.studentProfile.trainingStatus === TrainingStatus.ARCHIVED
  );
}

function isEligibleForPractice(student: {
  status: UserStatus;
  studentProfile: {
    trainingStatus: TrainingStatus;
    category: LicenseCategory | null;
    transmission: Transmission | null;
  };
}): boolean {
  const { trainingStatus, category, transmission } = student.studentProfile;
  return (
    student.status === UserStatus.ACTIVE &&
    (trainingStatus === TrainingStatus.ACTIVE ||
      trainingStatus === TrainingStatus.PRACTICE) &&
    category != null &&
    transmission != null
  );
}

function canChangeTrainingStatus(
  current: TrainingStatus,
  next: TrainingStatus,
): boolean {
  return TRAINING_STATUS_TRANSITIONS[current].includes(next);
}

function isTerminalTrainingStatus(status: TrainingStatus): boolean {
  return (TERMINAL_TRAINING_STATUSES as readonly TrainingStatus[]).includes(
    status,
  );
}

function enrollmentStatusForTraining(
  status: TrainingStatus,
): EnrollmentStatus | null {
  if (status === TrainingStatus.GRADUATED) {
    return EnrollmentStatus.COMPLETED;
  }
  if (status === TrainingStatus.DROPPED) {
    return EnrollmentStatus.DROPPED;
  }
  return null;
}

function isOpenGroup(status: GroupStatus): boolean {
  return status === GroupStatus.PLANNED || status === GroupStatus.ACTIVE;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * ADMIN бачить студентів своєї організації.
 * TEACHER і INSTRUCTOR мають той самий дозволений scope: лише студенти
 * їхньої організації. Групи та індивідуальні призначення ще не збережені,
 * тому вужчого зрізу в даних немає. Чужу організацію цей фільтр відсікає.
 */
function allowedStudentScope(actor: User): Prisma.UserWhereInput {
  const organizationStudents: Prisma.UserWhereInput = {
    organizationId: actor.organizationId,
    role: UserRole.STUDENT,
    deletedAt: null,
  };

  switch (actor.role) {
    case UserRole.ADMIN:
    case UserRole.TEACHER:
    case UserRole.INSTRUCTOR:
      return organizationStudents;
    default:
      throw new ForbiddenException('Insufficient permissions');
  }
}

function searchConditions(search: string): Prisma.UserWhereInput[] {
  const conditions: Prisma.UserWhereInput[] = [
    { firstName: contains(search) },
    { lastName: contains(search) },
    { email: contains(search) },
    { phone: contains(search) },
  ];

  const parts = search.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0];
    const rest = parts.slice(1).join(' ');
    conditions.push(
      {
        AND: [{ firstName: contains(first) }, { lastName: contains(rest) }],
      },
      {
        AND: [{ firstName: contains(rest) }, { lastName: contains(first) }],
      },
    );
  }

  return conditions;
}

function buildStudentWhere(
  actor: User,
  query: ListStudentsQueryDto,
): Prisma.UserWhereInput {
  const filters: Prisma.UserWhereInput[] = [allowedStudentScope(actor)];

  if (query.status) {
    filters.push({ status: query.status });
  }

  const search = query.search?.trim();
  if (search) {
    filters.push({ OR: searchConditions(search) });
  }

  return { AND: filters };
}

function buildOrderBy(
  sortBy: StudentSortField,
  sortOrder: StudentSortOrder,
): Prisma.UserOrderByWithRelationInput[] {
  const tieBreak: Prisma.UserOrderByWithRelationInput = { id: 'asc' };
  switch (sortBy) {
    case 'firstName':
      return [{ firstName: sortOrder }, tieBreak];
    case 'lastName':
      return [{ lastName: sortOrder }, tieBreak];
    case 'email':
      return [{ email: sortOrder }, tieBreak];
    case 'phone':
      return [{ phone: sortOrder }, tieBreak];
    case 'status':
      return [{ status: sortOrder }, tieBreak];
    case 'createdAt':
      return [{ createdAt: sortOrder }, tieBreak];
  }
}

function isVisibleStudent(row: StudentRow, organizationId: string): boolean {
  return (
    row.organizationId === organizationId &&
    row.role === UserRole.STUDENT &&
    row.deletedAt == null
  );
}

function toStudentListItem(row: StudentRow): StudentListItemDto {
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    avatarUrl: row.avatarUrl,
    role: row.role,
    status: row.status,
    organizationId: row.organizationId,
    createdAt: row.createdAt,
  };
}

function belongsToOrganization(
  row: StudentCardRow,
  organizationId: string,
): boolean {
  if (
    row.organizationId !== organizationId ||
    row.role !== UserRole.STUDENT ||
    row.deletedAt != null
  ) {
    return false;
  }

  return (
    !row.studentProfile || row.studentProfile.organizationId === organizationId
  );
}

function isOwnStudentProfile(row: StudentCardRow, actor: User): boolean {
  const profile = row.studentProfile;
  if (!profile) {
    return false;
  }

  return (
    row.id === actor.id &&
    row.organizationId === actor.organizationId &&
    belongsToOrganization(row, actor.organizationId) &&
    profile.userId === actor.id &&
    profile.userId === row.id &&
    profile.organizationId === actor.organizationId &&
    profile.organizationId === row.organizationId
  );
}

function toStudentCard(row: StudentCardRow): StudentCardDto {
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    avatarUrl: row.avatarUrl,
    role: row.role,
    status: row.status,
    organizationId: row.organizationId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    student: row.studentProfile
      ? {
          id: row.studentProfile.id,
          userId: row.studentProfile.userId,
          organizationId: row.studentProfile.organizationId,
          groupId: row.studentProfile.groupId,
          instructorId: row.studentProfile.instructorId,
          carId: row.studentProfile.carId,
          category: row.studentProfile.category ?? null,
          transmission: row.studentProfile.transmission ?? null,
          trainingStatus: row.studentProfile.trainingStatus,
        }
      : null,
  };
}

function fieldError(field: string, message: string): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    errors: [{ field, message }],
  });
}

function profileUpdate(payload: UpdateStudentDto): Prisma.UserUpdateInput {
  const data: Prisma.UserUpdateInput = {};

  if (payload.firstName !== undefined) {
    const firstName = payload.firstName.trim();
    if (!firstName) {
      throw fieldError('firstName', EMPTY_FIELD_MESSAGE);
    }
    data.firstName = firstName;
  }

  if (payload.lastName !== undefined) {
    const lastName = payload.lastName.trim();
    if (!lastName) {
      throw fieldError('lastName', EMPTY_FIELD_MESSAGE);
    }
    data.lastName = lastName;
  }

  if (payload.phone !== undefined) {
    data.phone = payload.phone === null ? null : payload.phone.trim() || null;
  }

  if (Object.keys(data).length === 0) {
    throw fieldError('body', NO_STUDENT_FIELDS_MESSAGE);
  }

  return data;
}

@Injectable()
export class StudentsService {
  private readonly logger = new Logger(StudentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async list(
    actor: User,
    query: ListStudentsQueryDto,
  ): Promise<StudentListDto> {
    assertCanListStudents(actor);
    await this.requireOrganization(actor.organizationId);

    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const sortBy = query.sortBy ?? DEFAULT_SORT_BY;
    const sortOrder = query.sortOrder ?? DEFAULT_SORT_ORDER;
    const where = buildStudentWhere(actor, query);

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: studentSelect,
        orderBy: buildOrderBy(sortBy, sortOrder),
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      students: rows
        .filter((row) => isVisibleStudent(row, actor.organizationId))
        .map(toStudentListItem),
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async create(
    actor: User,
    payload: CreateStudentDto,
  ): Promise<CreateStudentResponseDto> {
    assertCanCreateStudent(actor);
    const organization = await this.requireOrganization(actor.organizationId);

    const firstName = payload.firstName.trim();
    const lastName = payload.lastName.trim();
    const email = payload.email.trim().toLowerCase();
    const phone = payload.phone?.trim() || null;
    const groupId = payload.groupId ?? null;

    const token = randomBytes(48).toString('base64url');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    let created: {
      user: User;
      student: {
        id: string;
        userId: string;
        organizationId: string;
        groupId: string | null;
        instructorId: string | null;
        carId: string | null;
        category: LicenseCategory | null;
        transmission: Transmission | null;
        trainingStatus: TrainingStatus;
      };
      invitation: {
        id: string;
        email: string;
        role: UserRole;
        status: InvitationStatus;
        expiresAt: Date;
        userId: string;
        organizationId: string;
      };
    };

    try {
      created = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({ where: { email } });
        if (existing) {
          throw this.emailAlreadyExists();
        }

        if (groupId) {
          const group = await tx.group.findUnique({ where: { id: groupId } });
          if (!group || group.organizationId !== actor.organizationId) {
            throw new NotFoundException(GROUP_NOT_FOUND_MESSAGE);
          }
        }

        const user = await tx.user.create({
          data: {
            email,
            firstName,
            lastName,
            phone,
            passwordHash: null,
            role: UserRole.STUDENT,
            status: UserStatus.INVITED,
            organizationId: actor.organizationId,
          },
        });

        const student = await tx.student.create({
          data: {
            userId: user.id,
            organizationId: actor.organizationId,
            groupId,
            instructorId: null,
            carId: null,
            trainingStatus: TrainingStatus.INVITED,
          },
        });

        const invitation = await tx.invitation.create({
          data: {
            email,
            role: UserRole.STUDENT,
            tokenHash,
            status: InvitationStatus.PENDING,
            expiresAt,
            invitedById: actor.id,
            userId: user.id,
            organizationId: actor.organizationId,
          },
        });

        return { user, student, invitation };
      });
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      if (isUniqueConstraintOn(error, 'email')) {
        throw this.emailAlreadyExists();
      }
      throw error;
    }

    try {
      await this.mailService.sendEmail({
        to: email,
        subject: `Запрошення стати учнем — ${organization.name}`,
        html: this.buildInvitationHtml({
          firstName,
          organizationName: organization.name,
          inviterName: `${actor.firstName} ${actor.lastName}`.trim(),
          acceptUrl: invitationAcceptUrl(token),
          expiresAt,
        }),
      });
    } catch (error) {
      await this.prisma.user
        .delete({ where: { id: created.user.id } })
        .catch(() => undefined);
      throw error;
    }

    return {
      user: {
        id: created.user.id,
        firstName: created.user.firstName,
        lastName: created.user.lastName,
        email: created.user.email,
        phone: created.user.phone,
        role: created.user.role,
        status: created.user.status,
        organizationId: created.user.organizationId,
      },
      student: {
        id: created.student.id,
        userId: created.student.userId,
        organizationId: created.student.organizationId,
        groupId: created.student.groupId,
        instructorId: created.student.instructorId,
        carId: created.student.carId,
        category: created.student.category ?? null,
        transmission: created.student.transmission ?? null,
        trainingStatus: created.student.trainingStatus,
      },
      invitation: {
        id: created.invitation.id,
        email: created.invitation.email,
        role: created.invitation.role,
        status: created.invitation.status,
        expiresAt: created.invitation.expiresAt,
        userId: created.invitation.userId,
        organizationId: created.invitation.organizationId,
      },
    };
  }

  async getById(actor: User, studentId: string): Promise<StudentCardDto> {
    assertCanReadStudent(actor);
    await this.requireOrganization(actor.organizationId);
    const row = await this.findStudentCard(actor, studentId);
    return toStudentCard(row);
  }

  async getOwn(actor: User): Promise<StudentCardDto> {
    assertCanReadOwnStudent(actor);
    await this.requireOrganization(actor.organizationId);

    const row = await this.prisma.user.findFirst({
      where: {
        id: actor.id,
        organizationId: actor.organizationId,
        role: UserRole.STUDENT,
        deletedAt: null,
        studentProfile: {
          is: {
            userId: actor.id,
            organizationId: actor.organizationId,
          },
        },
      },
      select: studentCardSelect,
    });

    if (!row || !isOwnStudentProfile(row, actor)) {
      throw new NotFoundException(STUDENT_NOT_FOUND_MESSAGE);
    }

    return toStudentCard(row);
  }

  async update(
    actor: User,
    studentId: string,
    payload: UpdateStudentDto,
  ): Promise<StudentCardDto> {
    assertCanUpdateStudent(actor);
    await this.requireOrganization(actor.organizationId);

    const data = profileUpdate(payload);
    const existing = await this.findStudentCard(actor, studentId);
    const updated = await this.prisma.user.update({
      where: { id: existing.id },
      data,
      select: studentCardSelect,
    });

    if (!belongsToOrganization(updated, actor.organizationId)) {
      throw new NotFoundException(STUDENT_NOT_FOUND_MESSAGE);
    }

    return toStudentCard(updated);
  }

  async assignGroup(
    actor: User,
    studentId: string,
    payload: AssignStudentGroupDto,
  ): Promise<StudentCardDto> {
    assertCanAssignStudentGroup(actor);
    await this.requireOrganization(actor.organizationId);

    return this.prisma.$transaction(async (tx) => {
      const student = await tx.user.findFirst({
        where: {
          id: studentId,
          organizationId: actor.organizationId,
          role: UserRole.STUDENT,
          deletedAt: null,
        },
        select: studentCardSelect,
      });

      if (
        !student ||
        !belongsToOrganization(student, actor.organizationId) ||
        !student.studentProfile
      ) {
        throw new NotFoundException(STUDENT_NOT_FOUND_MESSAGE);
      }

      if (
        student.status === UserStatus.ARCHIVED ||
        isTerminalTrainingStatus(student.studentProfile.trainingStatus)
      ) {
        throw new ConflictException(STUDENT_TRAINING_STATUS_MESSAGE);
      }

      const terminalEnrollment = await tx.enrollment.findFirst({
        where: {
          studentId: student.id,
          status: { in: [...TERMINAL_ENROLLMENT_STATUSES] },
          group: { organizationId: actor.organizationId },
        },
      });
      if (terminalEnrollment) {
        throw new ConflictException(STUDENT_TRAINING_STATUS_MESSAGE);
      }

      const group = await tx.group.findUnique({
        where: { id: payload.groupId },
      });
      if (!group || group.organizationId !== actor.organizationId) {
        throw new NotFoundException(GROUP_NOT_FOUND_MESSAGE);
      }
      if (!isOpenGroup(group.status)) {
        throw new ConflictException(GROUP_NOT_ASSIGNABLE_MESSAGE);
      }

      const currentGroupId = student.studentProfile.groupId;
      if (currentGroupId && currentGroupId !== group.id) {
        const currentGroup = await tx.group.findUnique({
          where: { id: currentGroupId },
        });
        if (currentGroup && isOpenGroup(currentGroup.status)) {
          throw new ConflictException(STUDENT_ACTIVE_GROUP_MESSAGE);
        }
      }

      const otherActiveEnrollment = await tx.enrollment.findFirst({
        where: {
          studentId: student.id,
          status: EnrollmentStatus.ACTIVE,
          groupId: { not: group.id },
          group: { organizationId: actor.organizationId },
        },
      });
      if (otherActiveEnrollment) {
        throw new ConflictException(STUDENT_ACTIVE_GROUP_MESSAGE);
      }

      const profile = await tx.student.update({
        where: { id: student.studentProfile.id },
        data: { groupId: group.id },
      });
      await tx.enrollment.upsert({
        where: {
          groupId_studentId: {
            groupId: group.id,
            studentId: student.id,
          },
        },
        create: {
          groupId: group.id,
          studentId: student.id,
          status: EnrollmentStatus.ACTIVE,
        },
        update: { status: EnrollmentStatus.ACTIVE },
      });

      return toStudentCard({
        ...student,
        studentProfile: {
          ...student.studentProfile,
          groupId: profile.groupId,
        },
      });
    });
  }

  async changeTrainingStatus(
    actor: User,
    studentId: string,
    payload: UpdateStudentTrainingStatusDto,
  ): Promise<StudentCardDto> {
    assertCanChangeTrainingStatus(actor);
    await this.requireOrganization(actor.organizationId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const student = await tx.user.findFirst({
        where: {
          id: studentId,
          organizationId: actor.organizationId,
          role: UserRole.STUDENT,
          deletedAt: null,
        },
        select: studentCardSelect,
      });

      if (
        !student ||
        !belongsToOrganization(student, actor.organizationId) ||
        !student.studentProfile
      ) {
        throw new NotFoundException(STUDENT_NOT_FOUND_MESSAGE);
      }

      const current = student.studentProfile.trainingStatus;
      const next = payload.status;
      if (!canChangeTrainingStatus(current, next)) {
        throw new ConflictException(
          `${TRAINING_STATUS_TRANSITION_MESSAGE} ${current} → ${next}.`,
        );
      }

      const profile = await tx.student.update({
        where: { id: student.studentProfile.id },
        data: { trainingStatus: next },
      });

      const enrollmentStatus = enrollmentStatusForTraining(next);
      if (enrollmentStatus) {
        await tx.enrollment.updateMany({
          where: {
            studentId: student.id,
            status: EnrollmentStatus.ACTIVE,
            group: { organizationId: actor.organizationId },
          },
          data: { status: enrollmentStatus },
        });
      }

      this.logger.log(
        `Student training status changed studentId=${student.id} from=${current} to=${next} actorId=${actor.id} organizationId=${actor.organizationId}`,
      );

      return toStudentCard({
        ...student,
        studentProfile: {
          ...student.studentProfile,
          trainingStatus: profile.trainingStatus,
        },
      });
    });

    return updated;
  }

  async grantPracticeAccess(
    actor: User,
    studentId: string,
    payload: GrantPracticeAccessDto,
  ): Promise<StudentCardDto> {
    assertCanGrantPracticeAccess(actor);
    await this.requireOrganization(actor.organizationId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const student = await tx.user.findFirst({
        where: {
          id: studentId,
          organizationId: actor.organizationId,
          role: UserRole.STUDENT,
          deletedAt: null,
        },
        select: studentCardSelect,
      });

      if (
        !student ||
        !belongsToOrganization(student, actor.organizationId) ||
        !student.studentProfile
      ) {
        throw new NotFoundException(STUDENT_NOT_FOUND_MESSAGE);
      }

      if (isArchivedStudent(student)) {
        throw new ConflictException(ARCHIVED_STUDENT_BOOKING_MESSAGE);
      }

      if (!isEligibleForPractice(student)) {
        throw new ConflictException(STUDENT_PRACTICE_ACCESS_MESSAGE);
      }

      const instructor = await tx.user.findUnique({
        where: { id: payload.instructorId },
      });
      if (
        !instructor ||
        instructor.deletedAt ||
        instructor.organizationId !== actor.organizationId
      ) {
        throw new NotFoundException(INSTRUCTOR_NOT_FOUND_MESSAGE);
      }
      if (instructor.role !== UserRole.INSTRUCTOR) {
        throw new ConflictException(INSTRUCTOR_ROLE_MESSAGE);
      }
      if (instructor.status !== UserStatus.ACTIVE) {
        throw new ConflictException(INSTRUCTOR_NOT_ACTIVE_MESSAGE);
      }

      const car = await tx.car.findUnique({
        where: { id: payload.carId },
      });
      if (!car || car.organizationId !== actor.organizationId) {
        throw new NotFoundException(CAR_NOT_FOUND_MESSAGE);
      }
      if (
        car.instructorId !== instructor.id ||
        car.category !== student.studentProfile.category ||
        car.transmission !== student.studentProfile.transmission
      ) {
        throw new ConflictException(INSTRUCTOR_CAR_MISMATCH_MESSAGE);
      }

      const profile = await tx.student.update({
        where: { id: student.studentProfile.id },
        data: {
          instructorId: instructor.id,
          carId: car.id,
          trainingStatus: TrainingStatus.PRACTICE,
        },
      });

      this.logger.log(
        `Student practice access granted studentId=${student.id} instructorId=${instructor.id} carId=${car.id} actorId=${actor.id} organizationId=${actor.organizationId}`,
      );

      return toStudentCard({
        ...student,
        studentProfile: {
          ...student.studentProfile,
          instructorId: profile.instructorId,
          carId: profile.carId,
          trainingStatus: profile.trainingStatus,
        },
      });
    });

    return updated;
  }

  async archive(actor: User, studentId: string): Promise<StudentCardDto> {
    assertCanArchiveStudent(actor);
    await this.requireOrganization(actor.organizationId);

    return this.prisma.$transaction(async (tx) => {
      const student = await tx.user.findFirst({
        where: {
          id: studentId,
          organizationId: actor.organizationId,
          role: UserRole.STUDENT,
          deletedAt: null,
        },
        select: studentCardSelect,
      });

      if (
        !student ||
        !belongsToOrganization(student, actor.organizationId) ||
        !student.studentProfile
      ) {
        throw new NotFoundException(STUDENT_NOT_FOUND_MESSAGE);
      }

      await tx.user.update({
        where: { id: student.id },
        data: { status: UserStatus.ARCHIVED },
      });
      const profile = await tx.student.update({
        where: { id: student.studentProfile.id },
        data: { trainingStatus: TrainingStatus.ARCHIVED },
      });

      this.logger.log(
        `Student archived studentId=${student.id} actorId=${actor.id} organizationId=${actor.organizationId}`,
      );

      return toStudentCard({
        ...student,
        status: UserStatus.ARCHIVED,
        studentProfile: {
          ...student.studentProfile,
          trainingStatus: profile.trainingStatus,
        },
      });
    });
  }

  private async findStudentCard(
    actor: User,
    studentId: string,
  ): Promise<StudentCardRow> {
    const row = await this.prisma.user.findFirst({
      where: {
        id: studentId,
        organizationId: actor.organizationId,
        role: UserRole.STUDENT,
        deletedAt: null,
      },
      select: studentCardSelect,
    });

    if (!row || !belongsToOrganization(row, actor.organizationId)) {
      throw new NotFoundException(STUDENT_NOT_FOUND_MESSAGE);
    }

    return row;
  }

  private emailAlreadyExists() {
    return new ConflictException({
      statusCode: 409,
      errors: [{ field: 'email', message: EMAIL_ALREADY_EXISTS_MESSAGE }],
    });
  }

  private buildInvitationHtml(input: {
    firstName: string;
    organizationName: string;
    inviterName: string;
    acceptUrl: string;
    expiresAt: Date;
  }): string {
    const firstName = escapeHtml(input.firstName);
    const organizationName = escapeHtml(input.organizationName);
    const inviterName = escapeHtml(input.inviterName);
    const acceptUrl = escapeHtml(input.acceptUrl);
    const expiresAt = escapeHtml(
      input.expiresAt.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' }),
    );

    return `
<p>Вітаємо, ${firstName}!</p>
<p>${inviterName} запрошує вас стати учнем автошколи «${organizationName}».</p>
<p>Щоб прийняти запрошення, перейдіть за посиланням:<br />
<a href="${acceptUrl}">${acceptUrl}</a></p>
<p>Посилання дійсне до ${expiresAt}.</p>
`.trim();
  }

  private async requireOrganization(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization || organization.deletedAt) {
      throw new NotFoundException('Organization not found');
    }
    return organization;
  }
}
