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
  Prisma,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateGroupDto,
  GroupListDto,
  GroupListItemDto,
  UpdateGroupDto,
  UpdateGroupStatusDto,
} from './groups.dto';

export const GROUP_MANAGE_ROLES = [UserRole.ADMIN] as const;

export const GROUP_NOT_FOUND_MESSAGE = 'Group not found';
export const TEACHER_NOT_FOUND_MESSAGE = 'Teacher not found';
export const TEACHER_ROLE_MESSAGE = 'Користувач не має ролі TEACHER.';
export const TEACHER_NOT_ACTIVE_MESSAGE = 'Викладач має бути в статусі ACTIVE.';
export const GROUP_NAME_TAKEN_MESSAGE =
  'Відкрита група з такою назвою вже є в цій автошколі.';
export const GROUP_DATE_RANGE_MESSAGE =
  'Дата завершення не може бути раніше дати початку.';
export const GROUP_CLOSED_MESSAGE =
  'Групу зі статусом COMPLETED або ARCHIVED не можна редагувати.';
export const NO_GROUP_FIELDS_MESSAGE =
  'Немає дозволених полів для оновлення (name, teacherId, startDate, endDate).';
export const GROUP_STATUS_TRANSITION_MESSAGE =
  'Недозволений перехід статусу групи.';

const OPEN_GROUP_STATUSES: GroupStatus[] = [
  GroupStatus.PLANNED,
  GroupStatus.ACTIVE,
];

/**
 * Лише вперед. Повторне відкриття закритої групи заборонене: студент міг би
 * опинитися у двох відкритих групах одночасно (див. StudentsService.assignGroup).
 */
const GROUP_STATUS_TRANSITIONS: Record<GroupStatus, readonly GroupStatus[]> = {
  [GroupStatus.PLANNED]: [GroupStatus.ACTIVE, GroupStatus.ARCHIVED],
  [GroupStatus.ACTIVE]: [GroupStatus.COMPLETED, GroupStatus.ARCHIVED],
  [GroupStatus.COMPLETED]: [GroupStatus.ARCHIVED],
  [GroupStatus.ARCHIVED]: [],
};

const groupListInclude = {
  teacher: { select: { id: true, firstName: true, lastName: true } },
  _count: {
    select: {
      enrollments: { where: { status: EnrollmentStatus.ACTIVE } },
    },
  },
} satisfies Prisma.GroupInclude;

type GroupListRow = Prisma.GroupGetPayload<{
  include: typeof groupListInclude;
}>;

function assertCanManageGroups(actor: User): void {
  if (!(GROUP_MANAGE_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function fieldError(field: string, message: string): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    errors: [{ field, message }],
  });
}

function isOpenGroup(status: GroupStatus): boolean {
  return OPEN_GROUP_STATUSES.includes(status);
}

function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}

function assertDateRange(startDate: Date | null, endDate: Date | null): void {
  if (startDate && endDate && endDate.getTime() < startDate.getTime()) {
    throw fieldError('endDate', GROUP_DATE_RANGE_MESSAGE);
  }
}

function sameDate(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

function toGroupListItem(group: GroupListRow): GroupListItemDto {
  return {
    id: group.id,
    name: group.name,
    status: group.status,
    startDate: group.startDate,
    endDate: group.endDate,
    teacher: group.teacher,
    studentsCount: group._count.enrollments,
    createdAt: group.createdAt,
  };
}

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(admin: User): Promise<GroupListDto> {
    await this.requireOrganization(admin.organizationId);

    const groups = await this.prisma.group.findMany({
      where: { organizationId: admin.organizationId },
      include: groupListInclude,
      orderBy: { createdAt: 'desc' },
    });

    return { groups: groups.map(toGroupListItem) };
  }

  async create(
    actor: User,
    payload: CreateGroupDto,
  ): Promise<GroupListItemDto> {
    assertCanManageGroups(actor);
    await this.requireOrganization(actor.organizationId);

    const startDate = toDate(payload.startDate ?? null);
    const endDate = toDate(payload.endDate ?? null);
    assertDateRange(startDate, endDate);

    const created = await this.prisma.$transaction(async (tx) => {
      await this.requireTeacher(tx, actor.organizationId, payload.teacherId);
      await this.assertNameAvailable(tx, actor.organizationId, payload.name);
      return tx.group.create({
        data: {
          organizationId: actor.organizationId,
          name: payload.name,
          teacherId: payload.teacherId,
          startDate,
          endDate,
          status: GroupStatus.PLANNED,
        },
        include: groupListInclude,
      });
    });

    this.logger.log(
      `Group created groupId=${created.id} organizationId=${actor.organizationId} actorId=${actor.id}`,
    );
    return toGroupListItem(created);
  }

  async update(
    actor: User,
    groupId: string,
    payload: UpdateGroupDto,
  ): Promise<GroupListItemDto> {
    assertCanManageGroups(actor);
    await this.requireOrganization(actor.organizationId);
    if (
      payload.name === undefined &&
      payload.teacherId === undefined &&
      payload.startDate === undefined &&
      payload.endDate === undefined
    ) {
      throw fieldError('body', NO_GROUP_FIELDS_MESSAGE);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await this.requireGroup(tx, actor, groupId);
      if (!isOpenGroup(existing.status)) {
        throw new ConflictException(GROUP_CLOSED_MESSAGE);
      }

      const startDate =
        payload.startDate === undefined
          ? existing.startDate
          : toDate(payload.startDate);
      const endDate =
        payload.endDate === undefined
          ? existing.endDate
          : toDate(payload.endDate);
      assertDateRange(startDate, endDate);

      const data: Prisma.GroupUncheckedUpdateInput = {};
      if (payload.name !== undefined && payload.name !== existing.name) {
        await this.assertNameAvailable(
          tx,
          actor.organizationId,
          payload.name,
          existing.id,
        );
        data.name = payload.name;
      }
      if (
        payload.teacherId !== undefined &&
        payload.teacherId !== existing.teacherId
      ) {
        await this.requireTeacher(tx, actor.organizationId, payload.teacherId);
        data.teacherId = payload.teacherId;
      }
      if (!sameDate(startDate, existing.startDate)) {
        data.startDate = startDate;
      }
      if (!sameDate(endDate, existing.endDate)) {
        data.endDate = endDate;
      }

      if (Object.keys(data).length === 0) {
        return existing;
      }
      return tx.group.update({
        where: { id: existing.id },
        data,
        include: groupListInclude,
      });
    });

    this.logger.log(
      `Group updated groupId=${updated.id} organizationId=${actor.organizationId} actorId=${actor.id}`,
    );
    return toGroupListItem(updated);
  }

  async changeStatus(
    actor: User,
    groupId: string,
    payload: UpdateGroupStatusDto,
  ): Promise<GroupListItemDto> {
    assertCanManageGroups(actor);
    await this.requireOrganization(actor.organizationId);

    return this.prisma.$transaction(async (tx) => {
      const existing = await this.requireGroup(tx, actor, groupId);

      const next = payload.status;
      if (!GROUP_STATUS_TRANSITIONS[existing.status].includes(next)) {
        throw new ConflictException(
          `${GROUP_STATUS_TRANSITION_MESSAGE} ${existing.status} → ${next}.`,
        );
      }

      // Закриття групи завершує активні зарахування. COMPLETED, а не DROPPED:
      // DROPPED блокує студенту зарахування в будь-яку іншу групу.
      let completedEnrollments = 0;
      if (!isOpenGroup(next)) {
        const result = await tx.enrollment.updateMany({
          where: { groupId: existing.id, status: EnrollmentStatus.ACTIVE },
          data: { status: EnrollmentStatus.COMPLETED },
        });
        completedEnrollments = result.count;
      }

      const saved = await tx.group.update({
        where: { id: existing.id },
        data: { status: next },
        include: groupListInclude,
      });

      this.logger.log(
        `Group status changed groupId=${saved.id} from=${existing.status} to=${saved.status} completedEnrollments=${completedEnrollments} actorId=${actor.id} organizationId=${actor.organizationId}`,
      );
      return toGroupListItem(saved);
    });
  }

  private async requireGroup(
    tx: Prisma.TransactionClient,
    actor: User,
    groupId: string,
  ): Promise<GroupListRow> {
    const group = await tx.group.findFirst({
      where: { id: groupId, organizationId: actor.organizationId },
      include: groupListInclude,
    });
    if (!group) {
      throw new NotFoundException(GROUP_NOT_FOUND_MESSAGE);
    }
    return group;
  }

  private async requireTeacher(
    tx: Prisma.TransactionClient,
    organizationId: string,
    teacherId: string,
  ) {
    const teacher = await tx.user.findUnique({
      where: { id: teacherId },
      select: {
        organizationId: true,
        role: true,
        status: true,
        deletedAt: true,
      },
    });
    if (
      !teacher ||
      teacher.deletedAt ||
      teacher.organizationId !== organizationId
    ) {
      throw new NotFoundException(TEACHER_NOT_FOUND_MESSAGE);
    }
    if (teacher.role !== UserRole.TEACHER) {
      throw new ConflictException(TEACHER_ROLE_MESSAGE);
    }
    if (teacher.status !== UserStatus.ACTIVE) {
      throw new ConflictException(TEACHER_NOT_ACTIVE_MESSAGE);
    }
  }

  private async assertNameAvailable(
    tx: Prisma.TransactionClient,
    organizationId: string,
    name: string,
    excludeGroupId?: string,
  ) {
    const duplicate = await tx.group.findFirst({
      where: {
        organizationId,
        status: { in: OPEN_GROUP_STATUSES },
        name: { equals: name, mode: 'insensitive' },
        ...(excludeGroupId ? { NOT: { id: excludeGroupId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException({
        statusCode: 409,
        errors: [{ field: 'name', message: GROUP_NAME_TAKEN_MESSAGE }],
      });
    }
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
