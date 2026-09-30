import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { User, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListStudentsQueryDto } from './students.dto';
import { StudentsService } from './students.service';

function actor(role: UserRole, organizationId = 'org-1'): User {
  return {
    id: `${role.toLowerCase()}-1`,
    role,
    organizationId,
  } as User;
}

function studentRow(
  overrides: Partial<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    avatarUrl: string | null;
    role: UserRole;
    status: UserStatus;
    organizationId: string;
    createdAt: Date;
    deletedAt: Date | null;
  }> = {},
) {
  return {
    id: 'student-1',
    email: 'student@example.com',
    firstName: 'Олена',
    lastName: 'Коваль',
    phone: '+380991234567',
    avatarUrl: null,
    role: UserRole.STUDENT,
    status: UserStatus.ACTIVE,
    organizationId: 'org-1',
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

describe('StudentsService', () => {
  const organization = {
    id: 'org-1',
    deletedAt: null,
  };

  const prisma = {
    organization: { findUnique: jest.fn() },
    user: { findMany: jest.fn(), count: jest.fn() },
  };

  let service: StudentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.organization.findUnique.mockResolvedValue(organization);
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);
    service = new StudentsService(prisma as unknown as PrismaService);
  });

  it('returns students of the admin organization with default sort and pagination', async () => {
    const row = studentRow();
    prisma.user.findMany.mockResolvedValue([row]);
    prisma.user.count.mockResolvedValue(1);

    await expect(service.list(actor(UserRole.ADMIN), {})).resolves.toEqual({
      students: [
        {
          id: row.id,
          email: row.email,
          firstName: row.firstName,
          lastName: row.lastName,
          phone: row.phone,
          avatarUrl: null,
          role: UserRole.STUDENT,
          status: UserStatus.ACTIVE,
          organizationId: 'org-1',
          createdAt: row.createdAt,
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              organizationId: 'org-1',
              role: UserRole.STUDENT,
              deletedAt: null,
            },
          ],
        },
        orderBy: [{ lastName: 'asc' }, { id: 'asc' }],
        skip: 0,
        take: 20,
      }),
    );
    const queryArgs = prisma.user.findMany.mock.calls[0][0] as {
      select: Record<string, boolean>;
    };
    expect(queryArgs.select.email).toBe(true);
    expect(queryArgs.select).not.toHaveProperty('passwordHash');
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            organizationId: 'org-1',
            role: UserRole.STUDENT,
            deletedAt: null,
          },
        ],
      },
    });
  });

  it.each([UserRole.TEACHER, UserRole.INSTRUCTOR] as const)(
    'limits %s to students of their organization',
    async (role) => {
      await service.list(actor(role, 'org-2'), {});

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              {
                organizationId: 'org-2',
                role: UserRole.STUDENT,
                deletedAt: null,
              },
            ],
          },
        }),
      );
    },
  );

  it('does not return a student from another organization', async () => {
    prisma.user.findMany.mockResolvedValue([
      studentRow(),
      studentRow({
        id: 'student-other',
        email: 'other@example.com',
        organizationId: 'org-2',
      }),
      studentRow({
        id: 'teacher-row',
        role: UserRole.TEACHER,
        email: 'teacher@example.com',
      }),
      studentRow({
        id: 'deleted-student',
        deletedAt: new Date('2026-02-01T00:00:00.000Z'),
      }),
    ]);
    prisma.user.count.mockResolvedValue(1);

    const result = await service.list(actor(UserRole.ADMIN), {});

    expect(result.students.map((student) => student.id)).toEqual(['student-1']);
    expect(result.students[0]).not.toHaveProperty('passwordHash');
    expect(result.students[0]).not.toHaveProperty('deletedAt');
  });

  it('applies search, status filter, sorting and pagination', async () => {
    const query: ListStudentsQueryDto = {
      search: '  Ivan Petrenko  ',
      status: UserStatus.ACTIVE,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      page: 2,
      limit: 5,
    };

    await service.list(actor(UserRole.ADMIN), query);

    const contains = (value: string) => ({
      contains: value,
      mode: 'insensitive',
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              organizationId: 'org-1',
              role: UserRole.STUDENT,
              deletedAt: null,
            },
            { status: UserStatus.ACTIVE },
            {
              OR: [
                { firstName: contains('Ivan Petrenko') },
                { lastName: contains('Ivan Petrenko') },
                { email: contains('Ivan Petrenko') },
                { phone: contains('Ivan Petrenko') },
                {
                  AND: [
                    { firstName: contains('Ivan') },
                    { lastName: contains('Petrenko') },
                  ],
                },
                {
                  AND: [
                    { firstName: contains('Petrenko') },
                    { lastName: contains('Ivan') },
                  ],
                },
              ],
            },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: 5,
        take: 5,
      }),
    );
  });

  it('ignores a blank search', async () => {
    await service.list(actor(UserRole.TEACHER), { search: '   ' });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              organizationId: 'org-1',
              role: UserRole.STUDENT,
              deletedAt: null,
            },
          ],
        },
      }),
    );
  });

  it('returns an empty page with zero totalPages', async () => {
    await expect(service.list(actor(UserRole.INSTRUCTOR), {})).resolves.toEqual(
      {
        students: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      },
    );
  });

  it.each([UserRole.OWNER, UserRole.STUDENT] as const)(
    'rejects %s before reading students',
    async (role) => {
      await expect(service.list(actor(role), {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.organization.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    },
  );

  it('returns 404 when the organization is missing', async () => {
    prisma.organization.findUnique.mockResolvedValue(null);

    await expect(
      service.list(actor(UserRole.ADMIN), {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('returns 404 when the organization is deleted', async () => {
    prisma.organization.findUnique.mockResolvedValue({
      ...organization,
      deletedAt: new Date(),
    });

    await expect(
      service.list(actor(UserRole.ADMIN), {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
