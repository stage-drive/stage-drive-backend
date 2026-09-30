import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
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
  constructor(private readonly prisma: PrismaService) {}

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
