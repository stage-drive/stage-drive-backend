import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  LicenseCategory,
  Prisma,
  Transmission,
  User,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListCarsQueryDto } from './cars.dto';
import { CarsService } from './cars.service';

function actor(role: UserRole, organizationId = 'org-1', id?: string): User {
  return {
    id: id ?? `${role.toLowerCase()}-1`,
    role,
    organizationId,
  } as User;
}

function carRow(
  overrides: Partial<{
    id: string;
    organizationId: string;
    instructorId: string;
    plateNumber: string;
    category: LicenseCategory;
    transmission: Transmission;
    createdAt: Date;
    updatedAt: Date;
    instructor: { id: string; firstName: string; lastName: string };
  }> = {},
) {
  const instructorId = overrides.instructorId ?? 'instructor-1';
  return {
    id: 'car-1',
    organizationId: 'org-1',
    instructorId,
    plateNumber: 'AA0001BB',
    category: LicenseCategory.B,
    transmission: Transmission.MANUAL,
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    updatedAt: new Date('2026-01-03T00:00:00.000Z'),
    instructor: {
      id: instructorId,
      firstName: 'Тарас',
      lastName: 'Шевченко',
    },
    ...overrides,
  };
}

describe('CarsService', () => {
  const organization = {
    id: 'org-1',
    name: 'Автошкола Drive',
    deletedAt: null,
  };

  const prisma = {
    organization: { findUnique: jest.fn() },
    car: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  let service: CarsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.organization.findUnique.mockResolvedValue(organization);
    prisma.car.findMany.mockResolvedValue([]);
    prisma.car.count.mockResolvedValue(0);
    service = new CarsService(prisma as unknown as PrismaService);
  });

  it('returns cars of the admin organization with default sort and pagination', async () => {
    const row = carRow();
    prisma.car.findMany.mockResolvedValue([row]);
    prisma.car.count.mockResolvedValue(1);

    await expect(service.list(actor(UserRole.ADMIN), {})).resolves.toEqual({
      cars: [
        {
          id: row.id,
          organizationId: 'org-1',
          instructorId: 'instructor-1',
          instructor: {
            id: 'instructor-1',
            firstName: 'Тарас',
            lastName: 'Шевченко',
          },
          plateNumber: 'AA0001BB',
          category: LicenseCategory.B,
          transmission: Transmission.MANUAL,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    expect(prisma.car.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [{ organizationId: 'org-1' }],
        },
        orderBy: [{ plateNumber: 'asc' }, { id: 'asc' }],
        skip: 0,
        take: 20,
      }),
    );
    const queryArgs = prisma.car.findMany.mock.calls[0][0] as {
      select: {
        instructor: { select: Record<string, boolean> };
      };
    };
    expect(queryArgs.select.instructor.select).toEqual({
      id: true,
      firstName: true,
      lastName: true,
    });
    expect(queryArgs.select.instructor.select).not.toHaveProperty('email');
    expect(prisma.car.count).toHaveBeenCalledWith({
      where: { AND: [{ organizationId: 'org-1' }] },
    });
  });

  it('lets the owner see every car of the organization', async () => {
    await service.list(actor(UserRole.OWNER, 'org-2'), {});

    expect(prisma.car.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ organizationId: 'org-2' }] },
      }),
    );
  });

  it('limits an instructor to cars assigned to them', async () => {
    await service.list(actor(UserRole.INSTRUCTOR, 'org-1', 'instructor-9'), {});

    expect(prisma.car.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [{ organizationId: 'org-1', instructorId: 'instructor-9' }],
        },
      }),
    );
  });

  it('does not return a car from another organization or another instructor', async () => {
    prisma.car.findMany.mockResolvedValue([
      carRow(),
      carRow({
        id: 'car-other-org',
        organizationId: 'org-2',
        plateNumber: 'AA0005BB',
      }),
      carRow({
        id: 'car-other-instructor',
        instructorId: 'instructor-2',
        plateNumber: 'AA0004BB',
        instructor: {
          id: 'instructor-2',
          firstName: 'Богдан',
          lastName: 'Коваленко',
        },
      }),
    ]);
    prisma.car.count.mockResolvedValue(1);

    const result = await service.list(
      actor(UserRole.INSTRUCTOR, 'org-1', 'instructor-1'),
      {},
    );

    expect(result.cars.map((car) => car.id)).toEqual(['car-1']);
    expect(result.cars[0]).not.toHaveProperty('passwordHash');
  });

  it('applies search, filters, sorting and pagination', async () => {
    const query: ListCarsQueryDto = {
      search: '  aa0001  ',
      category: LicenseCategory.B,
      transmission: Transmission.MANUAL,
      instructorId: 'instructor-1',
      sortBy: 'createdAt',
      sortOrder: 'desc',
      page: 2,
      limit: 5,
    };

    await service.list(actor(UserRole.ADMIN), query);

    expect(prisma.car.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { organizationId: 'org-1' },
            { category: LicenseCategory.B },
            { transmission: Transmission.MANUAL },
            { instructorId: 'instructor-1' },
            {
              plateNumber: {
                contains: 'aa0001',
                mode: Prisma.QueryMode.insensitive,
              },
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
    await service.list(actor(UserRole.OWNER), { search: '   ' });

    expect(prisma.car.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ organizationId: 'org-1' }] },
      }),
    );
  });

  it('returns an empty page with zero totalPages', async () => {
    await expect(service.list(actor(UserRole.ADMIN), {})).resolves.toEqual({
      cars: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });

  it.each([UserRole.TEACHER, UserRole.STUDENT] as const)(
    'rejects %s before reading cars',
    async (role) => {
      await expect(service.list(actor(role), {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.organization.findUnique).not.toHaveBeenCalled();
      expect(prisma.car.findMany).not.toHaveBeenCalled();
    },
  );

  it('returns 404 when the organization is missing', async () => {
    prisma.organization.findUnique.mockResolvedValue(null);

    await expect(
      service.list(actor(UserRole.ADMIN), {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.car.findMany).not.toHaveBeenCalled();
  });

  it('returns 404 when the organization is deleted', async () => {
    prisma.organization.findUnique.mockResolvedValue({
      ...organization,
      deletedAt: new Date(),
    });

    await expect(
      service.list(actor(UserRole.OWNER), {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.car.findMany).not.toHaveBeenCalled();
  });
});
