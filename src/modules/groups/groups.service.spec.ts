import { NotFoundException } from '@nestjs/common';
import {
  EnrollmentStatus,
  GroupStatus,
  OrganizationStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GroupsService } from './groups.service';

describe('GroupsService', () => {
  const admin = {
    id: 'admin-1',
    role: UserRole.ADMIN,
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

  const groupRow = {
    id: 'group-1',
    name: 'ПДР — Група А',
    status: GroupStatus.ACTIVE,
    organizationId: 'org-1',
    teacherId: 'teacher-1',
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: null,
    createdAt: new Date('2026-09-29T19:20:00.000Z'),
    updatedAt: new Date('2026-09-30T08:00:00.000Z'),
    teacher: { id: 'teacher-1', firstName: 'Ірина', lastName: 'Мельник' },
    _count: { enrollments: 3 },
  };

  const prisma = {
    organization: { findUnique: jest.fn() },
    group: { findMany: jest.fn() },
  };

  let service: GroupsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.organization.findUnique.mockResolvedValue(organization);
    prisma.group.findMany.mockResolvedValue([]);
    service = new GroupsService(prisma as unknown as PrismaService);
  });

  it('returns an empty list when the school has no groups', async () => {
    await expect(service.list(admin as never)).resolves.toEqual({
      groups: [],
    });
  });

  it('scopes the query to the admin organization only', async () => {
    await service.list(admin as never);

    expect(prisma.organization.findUnique).toHaveBeenCalledWith({
      where: { id: 'org-1' },
    });
    expect(prisma.group.findMany).toHaveBeenCalledTimes(1);
    const [args] = prisma.group.findMany.mock.calls[0];
    expect(args.where).toEqual({ organizationId: 'org-1' });
  });

  it('maps groups to the public shape without internal fields', async () => {
    prisma.group.findMany.mockResolvedValue([groupRow]);

    await expect(service.list(admin as never)).resolves.toEqual({
      groups: [
        {
          id: 'group-1',
          name: 'ПДР — Група А',
          status: GroupStatus.ACTIVE,
          startDate: new Date('2026-10-01T00:00:00.000Z'),
          endDate: null,
          teacher: { id: 'teacher-1', firstName: 'Ірина', lastName: 'Мельник' },
          studentsCount: 3,
          createdAt: new Date('2026-09-29T19:20:00.000Z'),
        },
      ],
    });
  });

  it('selects only public teacher fields', async () => {
    await service.list(admin as never);

    const [args] = prisma.group.findMany.mock.calls[0];
    expect(args.include.teacher).toEqual({
      select: { id: true, firstName: true, lastName: true },
    });
  });

  it('counts only ACTIVE enrollments', async () => {
    await service.list(admin as never);

    const [args] = prisma.group.findMany.mock.calls[0];
    expect(args.include._count).toEqual({
      select: {
        enrollments: { where: { status: EnrollmentStatus.ACTIVE } },
      },
    });
  });

  it('orders groups from newest to oldest', async () => {
    await service.list(admin as never);

    const [args] = prisma.group.findMany.mock.calls[0];
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('throws NotFoundException when the organization does not exist', async () => {
    prisma.organization.findUnique.mockResolvedValue(null);

    await expect(service.list(admin as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.group.findMany).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the organization is soft-deleted', async () => {
    prisma.organization.findUnique.mockResolvedValue({
      ...organization,
      deletedAt: new Date(),
    });

    await expect(service.list(admin as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.group.findMany).not.toHaveBeenCalled();
  });
});
