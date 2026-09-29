import { NotFoundException } from '@nestjs/common';
import {
  GroupStatus,
  OrganizationStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
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
    group: { findMany: jest.fn() },
    lesson: { findMany: jest.fn() },
    enrollment: { findMany: jest.fn() },
  };

  let service: DashboardService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.organization.findUnique.mockResolvedValue(organization);
    prisma.user.groupBy.mockResolvedValue([]);
    prisma.invitation.count.mockResolvedValue(0);
    prisma.group.findMany.mockResolvedValue([]);
    prisma.lesson.findMany.mockResolvedValue([]);
    prisma.enrollment.findMany.mockResolvedValue([]);
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

  const teacher = {
    id: 'teacher-1',
    role: UserRole.TEACHER,
    organizationId: 'org-1',
    firstName: 'Ганна',
    lastName: 'Коваль',
    email: 'teacher@example.com',
    status: UserStatus.ACTIVE,
  };

  it('returns zero stats and empty lists when the teacher has no groups', async () => {
    await expect(service.getTeacherDashboard(teacher as never)).resolves.toEqual(
      {
        organization: {
          id: 'org-1',
          name: 'Stage Drive School',
          logoUrl: null,
          timezone: 'Europe/Kyiv',
        },
        teacher: {
          id: 'teacher-1',
          firstName: 'Ганна',
          lastName: 'Коваль',
          email: 'teacher@example.com',
          status: UserStatus.ACTIVE,
        },
        stats: { groupsTotal: 0, studentsTotal: 0, upcomingLessonsTotal: 0 },
        groups: [],
        upcomingLessons: [],
      },
    );

    expect(prisma.group.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { teacherId: 'teacher-1', organizationId: 'org-1' },
      }),
    );
    expect(prisma.lesson.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          group: { teacherId: 'teacher-1', organizationId: 'org-1' },
          scheduledAt: { gte: expect.any(Date) },
          status: 'SCHEDULED',
        },
        take: 5,
      }),
    );
    expect(prisma.enrollment.findMany).toHaveBeenCalledWith({
      where: {
        status: 'ACTIVE',
        group: { teacherId: 'teacher-1', organizationId: 'org-1' },
      },
      select: { studentId: true },
      distinct: ['studentId'],
    });
  });

  it('maps groups with their active-enrollment counts', async () => {
    prisma.group.findMany.mockResolvedValue([
      {
        id: 'group-1',
        name: 'ПДР — Група А',
        status: GroupStatus.ACTIVE,
        _count: { enrollments: 12 },
      },
      {
        id: 'group-2',
        name: 'ПДР — Група Б',
        status: GroupStatus.PLANNED,
        _count: { enrollments: 0 },
      },
    ]);

    const result = await service.getTeacherDashboard(teacher as never);

    expect(result.stats.groupsTotal).toBe(2);
    expect(result.groups).toEqual([
      {
        id: 'group-1',
        name: 'ПДР — Група А',
        status: GroupStatus.ACTIVE,
        studentsCount: 12,
      },
      {
        id: 'group-2',
        name: 'ПДР — Група Б',
        status: GroupStatus.PLANNED,
        studentsCount: 0,
      },
    ]);
  });

  it('counts distinct students, not the sum of per-group enrollment counts', async () => {
    prisma.group.findMany.mockResolvedValue([
      { id: 'group-1', name: 'A', status: GroupStatus.ACTIVE, _count: { enrollments: 2 } },
      { id: 'group-2', name: 'B', status: GroupStatus.ACTIVE, _count: { enrollments: 2 } },
    ]);
    // A student enrolled in both groups is returned once by the distinct query,
    // even though the per-group counts above sum to 4.
    prisma.enrollment.findMany.mockResolvedValue([
      { studentId: 'student-1' },
      { studentId: 'student-2' },
      { studentId: 'student-3' },
    ]);

    const result = await service.getTeacherDashboard(teacher as never);

    expect(result.stats.studentsTotal).toBe(3);
  });

  it('maps upcoming lessons with their group name, ordered by the query', async () => {
    const scheduledAt = new Date('2026-10-01T10:00:00.000Z');
    prisma.lesson.findMany.mockResolvedValue([
      {
        id: 'lesson-1',
        groupId: 'group-1',
        topic: 'Розділ 3: Дорожні знаки',
        scheduledAt,
        group: { name: 'ПДР — Група А' },
      },
    ]);

    const result = await service.getTeacherDashboard(teacher as never);

    expect(result.stats.upcomingLessonsTotal).toBe(1);
    expect(result.upcomingLessons).toEqual([
      {
        id: 'lesson-1',
        groupId: 'group-1',
        groupName: 'ПДР — Група А',
        topic: 'Розділ 3: Дорожні знаки',
        scheduledAt,
      },
    ]);
  });

  it('rejects a missing organization for teacher', async () => {
    prisma.organization.findUnique.mockResolvedValue(null);

    await expect(
      service.getTeacherDashboard(teacher as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.group.findMany).not.toHaveBeenCalled();
    expect(prisma.lesson.findMany).not.toHaveBeenCalled();
    expect(prisma.enrollment.findMany).not.toHaveBeenCalled();
  });

  it('rejects a deleted organization for teacher', async () => {
    prisma.organization.findUnique.mockResolvedValue({
      ...organization,
      deletedAt: new Date(),
    });

    await expect(
      service.getTeacherDashboard(teacher as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.group.findMany).not.toHaveBeenCalled();
  });

  const student = {
    id: 'student-1',
    role: UserRole.STUDENT,
    organizationId: 'org-1',
    firstName: 'Олена',
    lastName: 'Петренко',
    email: 'student@example.com',
    status: UserStatus.ACTIVE,
  };

  it('returns zero stats and empty lists when the student has no active enrollments', async () => {
    await expect(service.getStudentDashboard(student as never)).resolves.toEqual(
      {
        organization: {
          id: 'org-1',
          name: 'Stage Drive School',
          logoUrl: null,
          timezone: 'Europe/Kyiv',
        },
        student: {
          id: 'student-1',
          firstName: 'Олена',
          lastName: 'Петренко',
          email: 'student@example.com',
          status: UserStatus.ACTIVE,
        },
        stats: { groupsTotal: 0, upcomingLessonsTotal: 0 },
        groups: [],
        upcomingLessons: [],
      },
    );

    expect(prisma.enrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          studentId: 'student-1',
          status: 'ACTIVE',
          group: { organizationId: 'org-1' },
        },
      }),
    );
    expect(prisma.lesson.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          group: {
            organizationId: 'org-1',
            enrollments: {
              some: { studentId: 'student-1', status: 'ACTIVE' },
            },
          },
          scheduledAt: { gte: expect.any(Date) },
          status: 'SCHEDULED',
        },
        take: 5,
      }),
    );
  });

  it('maps enrolled groups with their teacher name', async () => {
    prisma.enrollment.findMany.mockResolvedValue([
      {
        group: {
          id: 'group-1',
          name: 'ПДР — Група А',
          status: GroupStatus.ACTIVE,
          teacher: { firstName: 'Ганна', lastName: 'Коваль' },
        },
      },
    ]);

    const result = await service.getStudentDashboard(student as never);

    expect(result.stats.groupsTotal).toBe(1);
    expect(result.groups).toEqual([
      {
        id: 'group-1',
        name: 'ПДР — Група А',
        status: GroupStatus.ACTIVE,
        teacherName: 'Ганна Коваль',
      },
    ]);
    expect(result.groups[0]).not.toHaveProperty('students');
  });

  it('maps upcoming lessons with their group name', async () => {
    const scheduledAt = new Date('2026-10-01T10:00:00.000Z');
    prisma.lesson.findMany.mockResolvedValue([
      {
        id: 'lesson-1',
        groupId: 'group-1',
        topic: 'Розділ 3: Дорожні знаки',
        scheduledAt,
        group: { name: 'ПДР — Група А' },
      },
    ]);

    const result = await service.getStudentDashboard(student as never);

    expect(result.stats.upcomingLessonsTotal).toBe(1);
    expect(result.upcomingLessons).toEqual([
      {
        id: 'lesson-1',
        groupId: 'group-1',
        groupName: 'ПДР — Група А',
        topic: 'Розділ 3: Дорожні знаки',
        scheduledAt,
      },
    ]);
  });

  it('rejects a missing organization for student', async () => {
    prisma.organization.findUnique.mockResolvedValue(null);

    await expect(
      service.getStudentDashboard(student as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.enrollment.findMany).not.toHaveBeenCalled();
    expect(prisma.lesson.findMany).not.toHaveBeenCalled();
  });

  it('rejects a deleted organization for student', async () => {
    prisma.organization.findUnique.mockResolvedValue({
      ...organization,
      deletedAt: new Date(),
    });

    await expect(
      service.getStudentDashboard(student as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.enrollment.findMany).not.toHaveBeenCalled();
  });
});
