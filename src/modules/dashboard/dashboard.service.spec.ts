import { NotFoundException } from '@nestjs/common';
import { OrganizationStatus, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  const owner = {
    id: 'owner-1',
    role: UserRole.OWNER,
    organizationId: 'org-1',
  };

  const organization = {
    id: 'org-1',
    name: 'Stage Drive School',
    status: OrganizationStatus.ACTIVE,
    logoUrl: null,
    timezone: 'Europe/Kyiv',
    deletedAt: null,
  };

  const prisma = {
    organization: { findUnique: jest.fn() },
    user: { groupBy: jest.fn() },
    invitation: { count: jest.fn() },
  };

  let service: DashboardService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.organization.findUnique.mockResolvedValue(organization);
    prisma.user.groupBy.mockResolvedValue([]);
    prisma.invitation.count.mockResolvedValue(0);
    service = new DashboardService(prisma as unknown as PrismaService);
  });

  it('returns zero counts when the school has no members or invitations', async () => {
    await expect(service.getOwnerDashboard(owner as never)).resolves.toEqual({
      organization: {
        id: 'org-1',
        name: 'Stage Drive School',
        status: OrganizationStatus.ACTIVE,
        logoUrl: null,
        timezone: 'Europe/Kyiv',
      },
      users: {
        total: 0,
        byRole: {
          OWNER: 0,
          ADMIN: 0,
          TEACHER: 0,
          INSTRUCTOR: 0,
          STUDENT: 0,
        },
        byStatus: {
          INVITED: 0,
          ACTIVE: 0,
          BLOCKED: 0,
          ARCHIVED: 0,
        },
      },
      invitations: { pending: 0, expired: 0 },
    });
  });

  it('counts only users and invitations of the owner organization', async () => {
    prisma.user.groupBy.mockResolvedValue([
      {
        role: UserRole.OWNER,
        status: UserStatus.ACTIVE,
        _count: { _all: 1 },
      },
      {
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        _count: { _all: 2 },
      },
      {
        role: UserRole.STUDENT,
        status: UserStatus.INVITED,
        _count: { _all: 3 },
      },
    ]);
    prisma.invitation.count.mockImplementation(
      (args: { where: { expiresAt?: { gt?: Date; lte?: Date } } }) => {
        if (args.where.expiresAt?.gt) {
          return Promise.resolve(4);
        }
        return Promise.resolve(1);
      },
    );

    const result = await service.getOwnerDashboard(owner as never);

    expect(prisma.user.groupBy).toHaveBeenCalledWith({
      by: ['role', 'status'],
      where: { organizationId: 'org-1', deletedAt: null },
      _count: { _all: true },
    });
    expect(prisma.invitation.count).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        status: 'PENDING',
        expiresAt: { gt: expect.any(Date) },
      },
    });
    expect(prisma.invitation.count).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        status: 'PENDING',
        expiresAt: { lte: expect.any(Date) },
      },
    });
    expect(result.users).toEqual({
      total: 6,
      byRole: {
        OWNER: 1,
        ADMIN: 2,
        TEACHER: 0,
        INSTRUCTOR: 0,
        STUDENT: 3,
      },
      byStatus: {
        INVITED: 3,
        ACTIVE: 3,
        BLOCKED: 0,
        ARCHIVED: 0,
      },
    });
    expect(result.invitations).toEqual({ pending: 4, expired: 1 });
  });

  it('rejects a missing organization', async () => {
    prisma.organization.findUnique.mockResolvedValue(null);

    await expect(
      service.getOwnerDashboard(owner as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.groupBy).not.toHaveBeenCalled();
  });

  it('rejects a deleted organization', async () => {
    prisma.organization.findUnique.mockResolvedValue({
      ...organization,
      deletedAt: new Date(),
    });

    await expect(
      service.getOwnerDashboard(owner as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.groupBy).not.toHaveBeenCalled();
  });

  const admin = {
    id: 'admin-1',
    role: UserRole.ADMIN,
    organizationId: 'org-1',
  };

  const memberRoles = {
    in: [UserRole.TEACHER, UserRole.INSTRUCTOR, UserRole.STUDENT],
  };

  it('returns zero member counts when the school has no teachers, instructors or students', async () => {
    await expect(service.getAdminDashboard(admin as never)).resolves.toEqual({
      organization: {
        id: 'org-1',
        name: 'Stage Drive School',
        logoUrl: null,
        timezone: 'Europe/Kyiv',
      },
      users: {
        total: 0,
        byRole: {
          TEACHER: 0,
          INSTRUCTOR: 0,
          STUDENT: 0,
        },
        byStatus: {
          INVITED: 0,
          ACTIVE: 0,
          BLOCKED: 0,
          ARCHIVED: 0,
        },
      },
      invitations: { pending: 0, expired: 0 },
    });
    expect(prisma.user.groupBy).toHaveBeenCalledWith({
      by: ['role', 'status'],
      where: {
        organizationId: 'org-1',
        deletedAt: null,
        role: memberRoles,
      },
      _count: { _all: true },
    });
  });

  it('counts only member roles of the admin organization', async () => {
    prisma.user.groupBy.mockResolvedValue([
      {
        role: UserRole.OWNER,
        status: UserStatus.ACTIVE,
        _count: { _all: 1 },
      },
      {
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        _count: { _all: 2 },
      },
      {
        role: UserRole.TEACHER,
        status: UserStatus.ACTIVE,
        _count: { _all: 3 },
      },
      {
        role: UserRole.INSTRUCTOR,
        status: UserStatus.BLOCKED,
        _count: { _all: 1 },
      },
      {
        role: UserRole.STUDENT,
        status: UserStatus.INVITED,
        _count: { _all: 4 },
      },
    ]);
    prisma.invitation.count.mockImplementation(
      (args: { where: { expiresAt?: { gt?: Date; lte?: Date } } }) => {
        if (args.where.expiresAt?.gt) {
          return Promise.resolve(2);
        }
        return Promise.resolve(1);
      },
    );

    const result = await service.getAdminDashboard(admin as never);

    expect(prisma.invitation.count).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        role: memberRoles,
        status: 'PENDING',
        expiresAt: { gt: expect.any(Date) },
      },
    });
    expect(prisma.invitation.count).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        role: memberRoles,
        status: 'PENDING',
        expiresAt: { lte: expect.any(Date) },
      },
    });
    expect(result.organization).not.toHaveProperty('status');
    expect(result.users).toEqual({
      total: 8,
      byRole: {
        TEACHER: 3,
        INSTRUCTOR: 1,
        STUDENT: 4,
      },
      byStatus: {
        INVITED: 4,
        ACTIVE: 3,
        BLOCKED: 1,
        ARCHIVED: 0,
      },
    });
    expect(result.users.byRole).not.toHaveProperty('OWNER');
    expect(result.users.byRole).not.toHaveProperty('ADMIN');
    expect(result.invitations).toEqual({ pending: 2, expired: 1 });
  });

  it('rejects a missing organization for admin', async () => {
    prisma.organization.findUnique.mockResolvedValue(null);

    await expect(
      service.getAdminDashboard(admin as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.groupBy).not.toHaveBeenCalled();
  });

  it('rejects a deleted organization for admin', async () => {
    prisma.organization.findUnique.mockResolvedValue({
      ...organization,
      deletedAt: new Date(),
    });

    await expect(
      service.getAdminDashboard(admin as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.groupBy).not.toHaveBeenCalled();
  });
});
