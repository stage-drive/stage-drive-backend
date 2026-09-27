import { Injectable, NotFoundException } from '@nestjs/common';
import { InvitationStatus, User, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminDashboardDto, OwnerDashboardDto } from './dashboard.dto';

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
