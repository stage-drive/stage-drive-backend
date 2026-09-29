import { Injectable, NotFoundException } from '@nestjs/common';
import { EnrollmentStatus, InvitationStatus, LessonStatus, User, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminDashboardDto, OwnerDashboardDto, TeacherDashboardDto } from './dashboard.dto';

const USER_ROLES = Object.values(UserRole);
const USER_STATUSES = Object.values(UserStatus);

const ADMIN_SCOPE_ROLES = [
  UserRole.TEACHER,
  UserRole.INSTRUCTOR,
  UserRole.STUDENT,
] as const;

type AdminScopeRole = (typeof ADMIN_SCOPE_ROLES)[number];

function emptyCounts<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

function isAdminScopeRole(role: UserRole): role is AdminScopeRole {
  return (ADMIN_SCOPE_ROLES as readonly UserRole[]).includes(role);
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getOwnerDashboard(owner: User): Promise<OwnerDashboardDto> {
    const organization = await this.requireOrganization(owner.organizationId);

    const now = new Date();
    const organizationId = owner.organizationId;
    const [groupedUsers, pending, expired] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['role', 'status'],
        where: { organizationId, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.invitation.count({
        where: {
          organizationId,
          status: InvitationStatus.PENDING,
          expiresAt: { gt: now },
        },
      }),
      this.prisma.invitation.count({
        where: {
          organizationId,
          status: InvitationStatus.PENDING,
          expiresAt: { lte: now },
        },
      }),
    ]);

    const byRole = emptyCounts(USER_ROLES);
    const byStatus = emptyCounts(USER_STATUSES);
    let total = 0;
    for (const row of groupedUsers) {
      const count = row._count._all;
      byRole[row.role] += count;
      byStatus[row.status] += count;
      total += count;
    }

    return {
      organization: {
        id: organization.id,
        name: organization.name,
        status: organization.status,
        logoUrl: organization.logoUrl,
        timezone: organization.timezone,
      },
      users: { total, byRole, byStatus },
      invitations: { pending, expired },
    };
  }

  async getAdminDashboard(admin: User): Promise<AdminDashboardDto> {
    const organization = await this.requireOrganization(admin.organizationId);

    const now = new Date();
    const scope = {
      organizationId: admin.organizationId,
      role: { in: [...ADMIN_SCOPE_ROLES] },
    };
    const [groupedUsers, pending, expired] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['role', 'status'],
        where: { ...scope, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.invitation.count({
        where: {
          ...scope,
          status: InvitationStatus.PENDING,
          expiresAt: { gt: now },
        },
      }),
      this.prisma.invitation.count({
        where: {
          ...scope,
          status: InvitationStatus.PENDING,
          expiresAt: { lte: now },
        },
      }),
    ]);

    const byRole = emptyCounts(ADMIN_SCOPE_ROLES);
    const byStatus = emptyCounts(USER_STATUSES);
    let total = 0;
    for (const row of groupedUsers) {
      if (!isAdminScopeRole(row.role)) {
        continue;
      }
      const count = row._count._all;
      byRole[row.role] += count;
      byStatus[row.status] += count;
      total += count;
    }

    return {
      organization: {
        id: organization.id,
        name: organization.name,
        logoUrl: organization.logoUrl,
        timezone: organization.timezone,
      },
      users: { total, byRole, byStatus },
      invitations: { pending, expired },
    };
  }

  async getTeacherDashboard(teacher: User): Promise<TeacherDashboardDto> {
    const organization = await this.requireOrganization(teacher.organizationId);
    const now = new Date();

    const [groups, upcomingLessons, distinctStudents] = await Promise.all([
      this.prisma.group.findMany({
        where: { teacherId: teacher.id, organizationId: teacher.organizationId },
        include: {
          _count: {
            select: { enrollments: { where: { status: EnrollmentStatus.ACTIVE } } },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.lesson.findMany({
        where: {
          group: { teacherId: teacher.id, organizationId: teacher.organizationId },
          scheduledAt: { gte: now },
          status: LessonStatus.SCHEDULED,
        },
        include: { group: { select: { name: true } } },
        orderBy: { scheduledAt: 'asc' },
        take: 5,
      }),
      this.prisma.enrollment.findMany({
        where: {
          status: EnrollmentStatus.ACTIVE,
          group: { teacherId: teacher.id, organizationId: teacher.organizationId },
        },
        select: { studentId: true },
        distinct: ['studentId'],
      }),
    ]);

    return {
      organization: {
        id: organization.id,
        name: organization.name,
        logoUrl: organization.logoUrl,
        timezone: organization.timezone,
      },
      teacher: {
        id: teacher.id,
        firstName: teacher.firstName,
        lastName: teacher.lastName,
        email: teacher.email,
        status: teacher.status,
      },
      stats: {
        groupsTotal: groups.length,
        studentsTotal: distinctStudents.length,
        upcomingLessonsTotal: upcomingLessons.length,
      },
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        status: group.status,
        studentsCount: group._count.enrollments,
      })),
      upcomingLessons: upcomingLessons.map((lesson) => ({
        id: lesson.id,
        groupId: lesson.groupId,
        groupName: lesson.group.name,
        topic: lesson.topic,
        scheduledAt: lesson.scheduledAt,
      })),
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
