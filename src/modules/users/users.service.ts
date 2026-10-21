import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_TOO_LONG_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
} from '../../common/validators/password.decorator';
import {
  PASSWORD_STRENGTH_MESSAGE,
  PASSWORD_STRENGTH_REGEX,
} from '../../common/validators/password-strength';
import { PrismaService } from '../../prisma/prisma.service';
import { RefreshTokenService } from '../auth/refresh-token.service';
import {
  ListOrganizationMembersQueryDto,
  MemberSortField,
  MemberSortOrder,
  OrganizationMemberDto,
  OrganizationMemberListDto,
  UpdateOrganizationMemberDto,
} from './users.dto';
import { toPublicUser } from './user-public';

const BCRYPT_ROUNDS = 10;

export const MEMBER_MANAGE_ROLES = [UserRole.OWNER, UserRole.ADMIN] as const;

export const MEMBER_NOT_FOUND_MESSAGE = 'Користувача не знайдено.';
export const ORGANIZATION_NOT_FOUND_MESSAGE =
  'Автошколу не знайдено або її видалено.';
export const NO_MEMBER_FIELDS_MESSAGE =
  'Немає дозволених полів для оновлення (firstName, lastName, phone).';
export const MEMBER_STATUS_TRANSITION_MESSAGE = 'Недозволений перехід статусу.';
export const INVITED_STATUS_MESSAGE =
  'Статус INVITED змінюється активацією запрошення або його скасуванням, а не цим запитом.';
export const SELF_PROFILE_MESSAGE =
  'Власний профіль читається через GET /api/users/me.';
export const SELF_UPDATE_MESSAGE =
  'Власні ім’я, прізвище і телефон змінюються через PATCH /api/users/me.';
export const SELF_STATUS_MESSAGE =
  'Не можна змінити статус власного облікового запису.';
export const MEMBER_ROLE_FILTER_MESSAGE =
  'Цю роль не можна переглядати з вашими правами.';

const EMPTY_FIELD_MESSAGE = "Заповніть обов'язкове поле.";
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const DEFAULT_SORT_BY: MemberSortField = 'lastName';
const DEFAULT_SORT_ORDER: MemberSortOrder = 'asc';

const OWNER_VISIBLE_ROLES: UserRole[] = [
  UserRole.ADMIN,
  UserRole.TEACHER,
  UserRole.INSTRUCTOR,
  UserRole.STUDENT,
];

const ADMIN_VISIBLE_ROLES: UserRole[] = [
  UserRole.TEACHER,
  UserRole.INSTRUCTOR,
  UserRole.STUDENT,
];

const MEMBER_STATUS_TRANSITIONS: Record<UserStatus, readonly UserStatus[]> = {
  [UserStatus.INVITED]: [],
  [UserStatus.ACTIVE]: [UserStatus.BLOCKED, UserStatus.ARCHIVED],
  [UserStatus.BLOCKED]: [UserStatus.ACTIVE, UserStatus.ARCHIVED],
  [UserStatus.ARCHIVED]: [UserStatus.ACTIVE],
};

const memberSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  status: true,
  organizationId: true,
  deletedAt: true,
  instructorCars: {
    orderBy: { plateNumber: 'asc' as const },
    select: {
      id: true,
      organizationId: true,
      plateNumber: true,
      category: true,
      transmission: true,
      status: true,
    },
  },
  receivedInvitations: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: {
      id: true,
      status: true,
      expiresAt: true,
    },
  },
} satisfies Prisma.UserSelect;

type MemberRow = Prisma.UserGetPayload<{ select: typeof memberSelect }>;
type MemberAction = 'read' | 'update' | 'status';

function visibleMemberRoles(actor: User): UserRole[] {
  if (actor.role === UserRole.OWNER) {
    return OWNER_VISIBLE_ROLES;
  }
  if (actor.role === UserRole.ADMIN) {
    return ADMIN_VISIBLE_ROLES;
  }
  return [];
}

function contains(value: string): Prisma.StringFilter {
  return { contains: value, mode: 'insensitive' };
}

function fieldError(field: string, message: string): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    errors: [{ field, message }],
  });
}

function statusError(message: string): ConflictException {
  return new ConflictException({
    statusCode: 409,
    errors: [{ field: 'status', message }],
  });
}

function assertCanManageMembers(actor: User): void {
  if (!(MEMBER_MANAGE_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function selfMessage(action: MemberAction): string {
  switch (action) {
    case 'read':
      return SELF_PROFILE_MESSAGE;
    case 'update':
      return SELF_UPDATE_MESSAGE;
    case 'status':
      return SELF_STATUS_MESSAGE;
  }
}

function toOrganizationMember(row: MemberRow): OrganizationMemberDto {
  const invitation = row.receivedInvitations[0] ?? null;
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    role: row.role,
    status: row.status,
    organizationId: row.organizationId,
    cars:
      row.role === UserRole.INSTRUCTOR
        ? row.instructorCars
            .filter((car) => car.organizationId === row.organizationId)
            .map((car) => ({
              id: car.id,
              plateNumber: car.plateNumber,
              category: car.category,
              transmission: car.transmission,
              status: car.status,
            }))
        : [],
    invitation: invitation
      ? {
          id: invitation.id,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
        }
      : null,
  };
}

function memberScope(actor: User, role?: UserRole): Prisma.UserWhereInput {
  const roles = visibleMemberRoles(actor);
  if (role && !roles.includes(role)) {
    throw fieldError('role', MEMBER_ROLE_FILTER_MESSAGE);
  }

  return {
    organizationId: actor.organizationId,
    role: role ?? { in: roles },
    deletedAt: null,
  };
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

function buildMemberWhere(
  actor: User,
  query: ListOrganizationMembersQueryDto,
): Prisma.UserWhereInput {
  const filters: Prisma.UserWhereInput[] = [memberScope(actor, query.role)];

  if (query.status) {
    filters.push({ status: query.status });
  }

  const search = query.search?.trim();
  if (search) {
    filters.push({ OR: searchConditions(search) });
  }

  return { AND: filters };
}

function buildMemberOrderBy(
  sortBy: MemberSortField,
  sortOrder: MemberSortOrder,
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
    case 'role':
      return [{ role: sortOrder }, tieBreak];
    case 'status':
      return [{ status: sortOrder }, tieBreak];
    case 'createdAt':
      return [{ createdAt: sortOrder }, tieBreak];
  }
}

function profileUpdate(
  payload: UpdateOrganizationMemberDto,
): Prisma.UserUpdateInput | null {
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

  return Object.keys(data).length > 0 ? data : null;
}

function assertStatusTransition(current: UserStatus, next: UserStatus): void {
  if (current === next) {
    return;
  }
  if (current === UserStatus.INVITED) {
    throw statusError(INVITED_STATUS_MESSAGE);
  }
  if (!MEMBER_STATUS_TRANSITIONS[current].includes(next)) {
    throw statusError(MEMBER_STATUS_TRANSITION_MESSAGE);
  }
}

export type UpdateProfileInput = {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
};

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  getMe(user: User) {
    return toPublicUser(user);
  }

  async updateMe(user: User, input: UpdateProfileInput) {
    const data: UpdateProfileInput = {};

    if (input.firstName !== undefined) {
      const firstName = input.firstName.trim();
      if (!firstName) {
        throw new BadRequestException('firstName cannot be empty');
      }
      data.firstName = firstName;
    }
    if (input.lastName !== undefined) {
      const lastName = input.lastName.trim();
      if (!lastName) {
        throw new BadRequestException('lastName cannot be empty');
      }
      data.lastName = lastName;
    }
    if (input.phone !== undefined) {
      data.phone = input.phone === null ? null : String(input.phone).trim();
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        'No allowed fields to update (firstName, lastName, phone)',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data,
    });
    return toPublicUser(updated);
  }

  async changePassword(
    user: User,
    currentPassword: string,
    newPassword: string,
  ) {
    if (!currentPassword || !newPassword) {
      throw new BadRequestException(
        'currentPassword and newPassword are required',
      );
    }
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      throw new BadRequestException(PASSWORD_TOO_SHORT_MESSAGE);
    }
    if (newPassword.length > PASSWORD_MAX_LENGTH) {
      throw new BadRequestException(PASSWORD_TOO_LONG_MESSAGE);
    }
    if (!PASSWORD_STRENGTH_REGEX.test(newPassword)) {
      throw new BadRequestException(PASSWORD_STRENGTH_MESSAGE);
    }

    const fresh = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!fresh) {
      throw new NotFoundException('User not found');
    }

    if (!fresh.passwordHash) {
      throw new BadRequestException('Current password is incorrect');
    }

    const matches = await bcrypt.compare(currentPassword, fresh.passwordHash);
    if (!matches) {
      throw new BadRequestException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, tokensInvalidBefore: new Date() },
    });
    await this.refreshTokenService.revokeAllForUser(user.id);

    return { message: 'Password updated' };
  }

  async listMembers(
    actor: User,
    query: ListOrganizationMembersQueryDto,
  ): Promise<OrganizationMemberListDto> {
    assertCanManageMembers(actor);
    await this.requireOrganization(actor.organizationId);

    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const sortBy = query.sortBy ?? DEFAULT_SORT_BY;
    const sortOrder = query.sortOrder ?? DEFAULT_SORT_ORDER;
    const where = buildMemberWhere(actor, query);

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: memberSelect,
        orderBy: buildMemberOrderBy(sortBy, sortOrder),
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      users: rows.map(toOrganizationMember),
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async getMember(actor: User, userId: string): Promise<OrganizationMemberDto> {
    const member = await this.requireMember(actor, userId, 'read');
    return toOrganizationMember(member);
  }

  /**
   * Email і role навмисно не приймаються.
   * Email активного акаунта змінює лише сам користувач через підтвердження листа.
   * Email і роль запрошення задаються під час запрошення: щоб їх змінити,
   * запрошення скасовують і створюють нове. Роль тягне за собою профіль учня,
   * групи, уроки водіння й автомобілі інструктора.
   * Автомобіль інструктору призначає модуль cars.
   */
  async updateMember(
    actor: User,
    userId: string,
    input: UpdateOrganizationMemberDto,
  ): Promise<OrganizationMemberDto> {
    const member = await this.requireMember(actor, userId, 'update');
    const data = profileUpdate(input);
    if (!data) {
      throw fieldError('body', NO_MEMBER_FIELDS_MESSAGE);
    }

    const updated = await this.prisma.user.update({
      where: { id: member.id },
      data,
      select: memberSelect,
    });
    return toOrganizationMember(updated);
  }

  async changeMemberStatus(
    actor: User,
    userId: string,
    nextStatus: UserStatus,
  ): Promise<OrganizationMemberDto> {
    const member = await this.requireMember(actor, userId, 'status');
    assertStatusTransition(member.status, nextStatus);
    if (member.status === nextStatus) {
      return toOrganizationMember(member);
    }

    const revokeSession =
      nextStatus === UserStatus.BLOCKED || nextStatus === UserStatus.ARCHIVED;
    const updated = await this.prisma.user.update({
      where: { id: member.id },
      data: {
        status: nextStatus,
        ...(revokeSession ? { tokensInvalidBefore: new Date() } : {}),
      },
      select: memberSelect,
    });
    if (revokeSession) {
      await this.refreshTokenService.revokeAllForUser(member.id);
    }

    this.logger.log(
      `Organization member status changed userId=${member.id} from=${member.status} to=${nextStatus} actorId=${actor.id} organizationId=${actor.organizationId}`,
    );
    return toOrganizationMember(updated);
  }

  async setAvatar(user: User, avatarUrl: string) {
    this.deleteLocalUpload(user.avatarUrl);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl },
    });
    return toPublicUser(updated);
  }

  async deleteAvatar(user: User) {
    this.deleteLocalUpload(user.avatarUrl);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl: null },
    });
    return toPublicUser(updated);
  }

  async deleteUser(user: User): Promise<void> {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { deletedAt: new Date() },
    });
  }

  private async requireOrganization(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization || organization.deletedAt) {
      throw new NotFoundException(ORGANIZATION_NOT_FOUND_MESSAGE);
    }
    return organization;
  }

  private async requireMember(
    actor: User,
    userId: string,
    action: MemberAction,
  ): Promise<MemberRow> {
    assertCanManageMembers(actor);
    await this.requireOrganization(actor.organizationId);

    const member = await this.prisma.user.findUnique({
      where: { id: userId },
      select: memberSelect,
    });
    if (
      !member ||
      member.deletedAt ||
      member.organizationId !== actor.organizationId
    ) {
      throw new NotFoundException(MEMBER_NOT_FOUND_MESSAGE);
    }
    if (member.id === actor.id) {
      throw new ForbiddenException(selfMessage(action));
    }
    if (!visibleMemberRoles(actor).includes(member.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return member;
  }

  private deleteLocalUpload(url?: string | null) {
    if (!url?.startsWith('/uploads/')) {
      return;
    }
    const relative = url.replace(/^\//, '');
    const fullPath = join(process.cwd(), relative);
    if (existsSync(fullPath)) {
      unlinkSync(fullPath);
    }
  }
}
