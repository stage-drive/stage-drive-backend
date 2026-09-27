import { Injectable, NotFoundException } from '@nestjs/common';
import { InvitationStatus, User, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OwnerDashboardDto } from './dashboard.dto';

const USER_ROLES = Object.values(UserRole);
const USER_STATUSES = Object.values(UserStatus);

function emptyCounts<T extends string>(keys: T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getOwnerDashboard(owner: User): Promise<OwnerDashboardDto> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: owner.organizationId },
    });
    if (!organization || organization.deletedAt) {
      throw new NotFoundException('Organization not found');
    }

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
}
