import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  LicenseCategory,
  Prisma,
  Transmission,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCarDto, ListCarsQueryDto, UpdateCarDto } from './cars.dto';
import {
  CAR_ASSIGNED_STUDENT_MESSAGE,
  CAR_NOT_FOUND_MESSAGE,
  CarsService,
  INSTRUCTOR_NOT_ACTIVE_MESSAGE,
  INSTRUCTOR_NOT_FOUND_MESSAGE,
  INSTRUCTOR_ROLE_MESSAGE,
  NO_CAR_FIELDS_MESSAGE,
  PLATE_ALREADY_EXISTS_MESSAGE,
} from './cars.service';

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

function instructorUser(
  overrides: Partial<{
    id: string;
    role: UserRole;
    status: UserStatus;
    organizationId: string;
    deletedAt: Date | null;
    firstName: string;
    lastName: string;
  }> = {},
) {
  return {
    id: 'instructor-1',
    role: UserRole.INSTRUCTOR,
    status: UserStatus.ACTIVE,
    organizationId: 'org-1',
    deletedAt: null,
    firstName: 'Тарас',
    lastName: 'Шевченко',
    ...overrides,
  };
}

function createPayload(overrides: Partial<CreateCarDto> = {}): CreateCarDto {
  return {
    plateNumber: ' aa-0003-bb ',
    category: LicenseCategory.B,
    transmission: Transmission.MANUAL,
    instructorId: 'instructor-1',
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
    user: { findUnique: jest.fn() },
    student: { findFirst: jest.fn() },
    car: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  let service: CarsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.organization.findUnique.mockResolvedValue(organization);
    prisma.car.findMany.mockResolvedValue([]);
    prisma.car.count.mockResolvedValue(0);
    prisma.car.findFirst.mockResolvedValue(null);
    prisma.car.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(instructorUser());
    prisma.student.findFirst.mockResolvedValue(null);
    prisma.car.create.mockImplementation(
      (args: {
        data: {
          organizationId: string;
          instructorId: string;
          plateNumber: string;
          category: LicenseCategory;
          transmission: Transmission;
        };
      }) =>
        Promise.resolve({
          id: 'car-new',
          ...args.data,
          createdAt: new Date('2026-04-01T00:00:00.000Z'),
          updatedAt: new Date('2026-04-01T00:00:00.000Z'),
          instructor: {
            id: args.data.instructorId,
            firstName: 'Тарас',
            lastName: 'Шевченко',
          },
        }),
    );
    prisma.car.update.mockImplementation(
      (args: {
        data: {
          plateNumber?: string;
          category?: LicenseCategory;
          transmission?: Transmission;
          instructorId?: string;
        };
      }) =>
        Promise.resolve({
          ...carRow(),
          ...args.data,
          instructor: {
            id: args.data.instructorId ?? 'instructor-1',
            firstName: 'Тарас',
            lastName: 'Шевченко',
          },
        }),
    );
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
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

  it.each([UserRole.OWNER, UserRole.ADMIN] as const)(
    'creates a car in the %s organization and normalizes the plate',
    async (role) => {
      const result = await service.create(
        actor(role, 'org-1'),
        createPayload(),
      );

      expect(result).toMatchObject({
        id: 'car-new',
        organizationId: 'org-1',
        instructorId: 'instructor-1',
        plateNumber: 'AA0003BB',
        category: LicenseCategory.B,
        transmission: Transmission.MANUAL,
        instructor: {
          id: 'instructor-1',
          firstName: 'Тарас',
          lastName: 'Шевченко',
        },
      });
      expect(result).not.toHaveProperty('passwordHash');
      expect(prisma.car.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          instructorId: 'instructor-1',
          plateNumber: 'AA0003BB',
          category: LicenseCategory.B,
          transmission: Transmission.MANUAL,
        },
        select: expect.any(Object),
      });
      expect(prisma.car.findFirst).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          plateNumber: {
            equals: 'AA0003BB',
            mode: Prisma.QueryMode.insensitive,
          },
        },
        select: { id: true },
      });
    },
  );

  it.each([UserRole.INSTRUCTOR, UserRole.TEACHER, UserRole.STUDENT] as const)(
    'rejects create for %s before writing',
    async (role) => {
      await expect(
        service.create(actor(role), createPayload()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.organization.findUnique).not.toHaveBeenCalled();
      expect(prisma.car.create).not.toHaveBeenCalled();
    },
  );

  it('does not create a car for an instructor from another organization', async () => {
    prisma.user.findUnique.mockResolvedValue(
      instructorUser({ organizationId: 'org-2' }),
    );

    await expect(
      service.create(actor(UserRole.ADMIN), createPayload()),
    ).rejects.toMatchObject({ message: INSTRUCTOR_NOT_FOUND_MESSAGE });
    expect(prisma.car.create).not.toHaveBeenCalled();
  });

  it('rejects a missing or deleted instructor', async () => {
    prisma.user.findUnique.mockResolvedValue(
      instructorUser({ deletedAt: new Date() }),
    );

    await expect(
      service.create(actor(UserRole.OWNER), createPayload()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.car.create).not.toHaveBeenCalled();
  });

  it('rejects an instructor with the wrong role', async () => {
    prisma.user.findUnique.mockResolvedValue(
      instructorUser({ role: UserRole.TEACHER }),
    );

    await expect(
      service.create(actor(UserRole.ADMIN), createPayload()),
    ).rejects.toMatchObject({ message: INSTRUCTOR_ROLE_MESSAGE });
    expect(prisma.car.create).not.toHaveBeenCalled();
  });

  it('rejects an instructor who is not ACTIVE', async () => {
    prisma.user.findUnique.mockResolvedValue(
      instructorUser({ status: UserStatus.BLOCKED }),
    );

    await expect(
      service.create(actor(UserRole.ADMIN), createPayload()),
    ).rejects.toMatchObject({ message: INSTRUCTOR_NOT_ACTIVE_MESSAGE });
    expect(prisma.car.create).not.toHaveBeenCalled();
  });

  it('rejects a plate that already exists in the same organization', async () => {
    prisma.car.findFirst.mockResolvedValue({ id: 'car-1' });

    await expect(
      service.create(actor(UserRole.ADMIN), createPayload()),
    ).rejects.toMatchObject({
      response: {
        statusCode: 409,
        errors: [
          { field: 'plateNumber', message: PLATE_ALREADY_EXISTS_MESSAGE },
        ],
      },
    });
    expect(prisma.car.create).not.toHaveBeenCalled();
  });

  it('maps a unique plate constraint to the same conflict', async () => {
    prisma.car.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.9.1',
        meta: { target: ['organizationId', 'plateNumber'] },
      }),
    );

    await expect(
      service.create(actor(UserRole.OWNER), createPayload()),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an invalid plate before writing', async () => {
    await expect(
      service.create(
        actor(UserRole.ADMIN),
        createPayload({ plateNumber: 'АА0003ВВ' }),
      ),
    ).rejects.toMatchObject({
      response: {
        statusCode: 400,
        errors: [{ field: 'plateNumber' }],
      },
    });
    expect(prisma.car.create).not.toHaveBeenCalled();
  });

  it('returns 404 when creating a car for a deleted organization', async () => {
    prisma.organization.findUnique.mockResolvedValue({
      ...organization,
      deletedAt: new Date(),
    });

    await expect(
      service.create(actor(UserRole.ADMIN), createPayload()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.car.create).not.toHaveBeenCalled();
  });

  it('updates the plate of a car in the same organization', async () => {
    prisma.car.findUnique.mockResolvedValue(carRow());

    const result = await service.update(actor(UserRole.ADMIN), 'car-1', {
      plateNumber: 'aa 0099 bb',
    });

    expect(result).toMatchObject({
      id: 'car-1',
      organizationId: 'org-1',
      plateNumber: 'AA0099BB',
    });
    expect(prisma.car.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'car-1' },
        data: { plateNumber: 'AA0099BB' },
      }),
    );
    expect(prisma.car.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-1',
          NOT: { id: 'car-1' },
        }),
      }),
    );
    expect(prisma.student.findFirst).not.toHaveBeenCalled();
  });

  it('does not update a car from another organization', async () => {
    prisma.car.findUnique.mockResolvedValue(
      carRow({ organizationId: 'org-2' }),
    );

    await expect(
      service.update(actor(UserRole.OWNER, 'org-1'), 'car-1', {
        plateNumber: 'AA0099BB',
      }),
    ).rejects.toMatchObject({ message: CAR_NOT_FOUND_MESSAGE });
    expect(prisma.car.update).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the car does not exist', async () => {
    await expect(
      service.update(actor(UserRole.ADMIN), 'car-missing', {
        category: LicenseCategory.C,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.car.update).not.toHaveBeenCalled();
  });

  it('rejects an empty update', async () => {
    const payload: UpdateCarDto = {};

    await expect(
      service.update(actor(UserRole.ADMIN), 'car-1', payload),
    ).rejects.toMatchObject({
      response: {
        statusCode: 400,
        errors: [{ field: 'body', message: NO_CAR_FIELDS_MESSAGE }],
      },
    });
    expect(prisma.car.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a plate that belongs to another car of the same organization', async () => {
    prisma.car.findUnique.mockResolvedValue(carRow());
    prisma.car.findFirst.mockResolvedValue({ id: 'car-2' });

    await expect(
      service.update(actor(UserRole.ADMIN), 'car-1', {
        plateNumber: 'AA0002BB',
      }),
    ).rejects.toMatchObject({
      response: {
        errors: [
          { field: 'plateNumber', message: PLATE_ALREADY_EXISTS_MESSAGE },
        ],
      },
    });
    expect(prisma.car.update).not.toHaveBeenCalled();
  });

  it('changes category when no student is assigned', async () => {
    prisma.car.findUnique.mockResolvedValue(carRow());

    await service.update(actor(UserRole.OWNER), 'car-1', {
      category: LicenseCategory.C,
    });

    expect(prisma.student.findFirst).toHaveBeenCalled();
    expect(prisma.car.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { category: LicenseCategory.C },
      }),
    );
  });

  it('rejects category, transmission or instructor changes that break an assignment', async () => {
    prisma.car.findUnique.mockResolvedValue(carRow());
    prisma.student.findFirst.mockResolvedValue({ id: 'student-1' });

    await expect(
      service.update(actor(UserRole.ADMIN), 'car-1', {
        transmission: Transmission.AUTOMATIC,
      }),
    ).rejects.toMatchObject({ message: CAR_ASSIGNED_STUDENT_MESSAGE });
    expect(prisma.car.update).not.toHaveBeenCalled();
  });

  it('reassigns the car to another active instructor of the same organization', async () => {
    prisma.car.findUnique.mockResolvedValue(carRow());
    prisma.user.findUnique.mockResolvedValue(
      instructorUser({ id: 'instructor-2' }),
    );

    await service.update(actor(UserRole.ADMIN), 'car-1', {
      instructorId: 'instructor-2',
    });

    expect(prisma.car.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { instructorId: 'instructor-2' },
      }),
    );
    expect(prisma.car.update.mock.calls[0][0].data).not.toHaveProperty(
      'organizationId',
    );
  });

  it.each([UserRole.INSTRUCTOR, UserRole.TEACHER, UserRole.STUDENT] as const)(
    'rejects update for %s before writing',
    async (role) => {
      await expect(
        service.update(actor(role), 'car-1', { plateNumber: 'AA0099BB' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.car.findUnique).not.toHaveBeenCalled();
      expect(prisma.car.update).not.toHaveBeenCalled();
    },
  );
});
