import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvitationStatus,
  Prisma,
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
  CreateStudentDto,
  CreateStudentResponseDto,
  ListStudentsQueryDto,
  StudentListDto,
  StudentListItemDto,
  StudentSortField,
  StudentSortOrder,
} from './students.dto';

export const STUDENT_LIST_ROLES = [
  UserRole.ADMIN,
  UserRole.TEACHER,
  UserRole.INSTRUCTOR,
] as const;

export const STUDENT_CREATE_ROLES = [UserRole.OWNER, UserRole.ADMIN] as const;

export const GROUP_NOT_FOUND_MESSAGE = 'Group not found';

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

@Injectable()
export class StudentsService {
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
