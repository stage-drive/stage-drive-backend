import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EnrollmentStatus,
  GroupStatus,
  OrganizationStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  GROUP_CLOSED_MESSAGE,
  GROUP_DATE_RANGE_MESSAGE,
  GROUP_NAME_TAKEN_MESSAGE,
  GROUP_NOT_FOUND_MESSAGE,
  GROUP_STATUS_TRANSITION_MESSAGE,
  GroupsService,
  NO_GROUP_FIELDS_MESSAGE,
  TEACHER_NOT_ACTIVE_MESSAGE,
  TEACHER_NOT_FOUND_MESSAGE,
  TEACHER_ROLE_MESSAGE,
} from './groups.service';

async function caught(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('Expected the promise to reject');
}

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

  const teacher = {
    organizationId: 'org-1',
    role: UserRole.TEACHER,
    status: UserStatus.ACTIVE,
    deletedAt: null,
  };

  const prisma = {
    organization: { findUnique: jest.fn() },
    group: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    enrollment: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  };

  let service: GroupsService;
  let log: jest.SpyInstance;

  // group.findFirst serves two lookups: the group itself (include) and the
  // duplicate-name check (select). Route each to its own fixture.
  function mockGroupLookups({
    existing = null,
    duplicate = null,
  }: {
    existing?: object | null;
    duplicate?: object | null;
  }) {
    prisma.group.findFirst.mockImplementation((args: { select?: object }) =>
      Promise.resolve(args.select ? duplicate : existing),
    );
  }

  function nameLookupArgs() {
    return prisma.group.findFirst.mock.calls
      .map(([args]: [{ select?: object; where: object }]) => args)
      .filter((args) => args.select);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.organization.findUnique.mockResolvedValue(organization);
    prisma.group.findMany.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue(teacher);
    prisma.enrollment.updateMany.mockResolvedValue({ count: 0 });
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    mockGroupLookups({});
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    service = new GroupsService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    log.mockRestore();
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

  describe('create', () => {
    const payload = {
      name: 'ПДР — Група Б',
      teacherId: 'teacher-1',
      startDate: '2026-11-01',
      endDate: '2027-01-31',
    };

    beforeEach(() => {
      prisma.group.create.mockResolvedValue({
        ...groupRow,
        id: 'group-2',
        name: 'ПДР — Група Б',
        status: GroupStatus.PLANNED,
        startDate: new Date('2026-11-01T00:00:00.000Z'),
        endDate: new Date('2027-01-31T00:00:00.000Z'),
        _count: { enrollments: 0 },
      });
    });

    it('creates a PLANNED group in the actor organization and returns the list shape', async () => {
      await expect(service.create(admin as never, payload)).resolves.toEqual({
        id: 'group-2',
        name: 'ПДР — Група Б',
        status: GroupStatus.PLANNED,
        startDate: new Date('2026-11-01T00:00:00.000Z'),
        endDate: new Date('2027-01-31T00:00:00.000Z'),
        teacher: { id: 'teacher-1', firstName: 'Ірина', lastName: 'Мельник' },
        studentsCount: 0,
        createdAt: new Date('2026-09-29T19:20:00.000Z'),
      });

      expect(prisma.group.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          name: 'ПДР — Група Б',
          teacherId: 'teacher-1',
          startDate: new Date('2026-11-01T00:00:00.000Z'),
          endDate: new Date('2027-01-31T00:00:00.000Z'),
          status: GroupStatus.PLANNED,
        },
        include: {
          teacher: { select: { id: true, firstName: true, lastName: true } },
          _count: {
            select: {
              enrollments: { where: { status: EnrollmentStatus.ACTIVE } },
            },
          },
        },
      });
      expect(log).toHaveBeenCalledWith(
        'Group created groupId=group-2 organizationId=org-1 actorId=admin-1',
      );
    });

    it('stores missing dates as null', async () => {
      await service.create(admin as never, {
        name: 'ПДР — Група Б',
        teacherId: 'teacher-1',
      });

      const [args] = prisma.group.create.mock.calls[0];
      expect(args.data.startDate).toBeNull();
      expect(args.data.endDate).toBeNull();
    });

    it('allows the same start and end date', async () => {
      await expect(
        service.create(admin as never, {
          ...payload,
          endDate: payload.startDate,
        }),
      ).resolves.toBeDefined();
    });

    it('rejects endDate before startDate before opening a transaction', async () => {
      const error = await caught(
        service.create(admin as never, {
          ...payload,
          startDate: '2026-12-01',
          endDate: '2026-11-30',
        }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'endDate', message: GROUP_DATE_RANGE_MESSAGE }],
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each([
      ['does not exist', null],
      [
        'belongs to another organization',
        { ...teacher, organizationId: 'org-2' },
      ],
      ['is soft-deleted', { ...teacher, deletedAt: new Date() }],
    ])('returns 404 when the teacher %s', async (_, found) => {
      prisma.user.findUnique.mockResolvedValue(found);

      const error = await caught(service.create(admin as never, payload));

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(TEACHER_NOT_FOUND_MESSAGE);
      expect(prisma.group.create).not.toHaveBeenCalled();
    });

    it('returns 409 when the user is not a TEACHER', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...teacher,
        role: UserRole.INSTRUCTOR,
      });

      const error = await caught(service.create(admin as never, payload));

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(TEACHER_ROLE_MESSAGE);
      expect(prisma.group.create).not.toHaveBeenCalled();
    });

    it.each([UserStatus.INVITED, UserStatus.BLOCKED, UserStatus.ARCHIVED])(
      'returns 409 when the teacher is %s',
      async (status) => {
        prisma.user.findUnique.mockResolvedValue({ ...teacher, status });

        const error = await caught(service.create(admin as never, payload));

        expect(error).toBeInstanceOf(ConflictException);
        expect(error.message).toBe(TEACHER_NOT_ACTIVE_MESSAGE);
        expect(prisma.group.create).not.toHaveBeenCalled();
      },
    );

    it('returns 409 with a name field error when an open group already has the name', async () => {
      mockGroupLookups({ duplicate: { id: 'group-1' } });

      const error = await caught(service.create(admin as never, payload));

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual({
        statusCode: 409,
        errors: [{ field: 'name', message: GROUP_NAME_TAKEN_MESSAGE }],
      });
      expect(prisma.group.create).not.toHaveBeenCalled();
    });

    it('checks the name case-insensitively among open groups of the organization only', async () => {
      await service.create(admin as never, payload);

      expect(nameLookupArgs()).toEqual([
        {
          where: {
            organizationId: 'org-1',
            status: { in: [GroupStatus.PLANNED, GroupStatus.ACTIVE] },
            name: { equals: 'ПДР — Група Б', mode: 'insensitive' },
          },
          select: { id: true },
        },
      ]);
    });

    it.each([
      UserRole.OWNER,
      UserRole.TEACHER,
      UserRole.INSTRUCTOR,
      UserRole.STUDENT,
    ])('forbids %s before touching the database', async (role) => {
      await expect(
        service.create({ ...admin, role } as never, payload),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    });

    it('returns 404 when the organization is soft-deleted', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        ...organization,
        deletedAt: new Date(),
      });

      await expect(
        service.create(admin as never, payload),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    const existing = {
      ...groupRow,
      status: GroupStatus.ACTIVE,
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: new Date('2026-12-31T00:00:00.000Z'),
    };

    beforeEach(() => {
      mockGroupLookups({ existing });
      prisma.group.update.mockImplementation(({ data }: { data: object }) =>
        Promise.resolve({ ...existing, ...data }),
      );
    });

    it('rejects an empty body before touching the group', async () => {
      const error = await caught(service.update(admin as never, 'group-1', {}));

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'body', message: NO_GROUP_FIELDS_MESSAGE }],
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('looks the group up inside the actor organization and returns 404 otherwise', async () => {
      mockGroupLookups({ existing: null });

      const error = await caught(
        service.update(admin as never, 'group-1', { name: 'Нова назва' }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(GROUP_NOT_FOUND_MESSAGE);
      const [args] = prisma.group.findFirst.mock.calls[0];
      expect(args.where).toEqual({ id: 'group-1', organizationId: 'org-1' });
      expect(prisma.group.update).not.toHaveBeenCalled();
    });

    it.each([GroupStatus.COMPLETED, GroupStatus.ARCHIVED])(
      'returns 409 for a %s group',
      async (status) => {
        mockGroupLookups({ existing: { ...existing, status } });

        const error = await caught(
          service.update(admin as never, 'group-1', { name: 'Нова назва' }),
        );

        expect(error).toBeInstanceOf(ConflictException);
        expect(error.message).toBe(GROUP_CLOSED_MESSAGE);
        expect(prisma.group.update).not.toHaveBeenCalled();
      },
    );

    it('allows editing a PLANNED group', async () => {
      mockGroupLookups({
        existing: { ...existing, status: GroupStatus.PLANNED },
      });

      await expect(
        service.update(admin as never, 'group-1', { name: 'Нова назва' }),
      ).resolves.toMatchObject({ name: 'Нова назва' });
    });

    it('writes only the fields that actually changed', async () => {
      await service.update(admin as never, 'group-1', {
        name: 'Нова назва',
        teacherId: 'teacher-1',
        startDate: '2026-10-01',
      });

      expect(prisma.group.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'group-1' },
          data: { name: 'Нова назва' },
        }),
      );
    });

    it('skips the write and returns the current group when nothing changes', async () => {
      await expect(
        service.update(admin as never, 'group-1', {
          name: existing.name,
          teacherId: existing.teacherId,
          startDate: '2026-10-01',
          endDate: '2026-12-31',
        }),
      ).resolves.toMatchObject({ id: 'group-1', name: existing.name });

      expect(prisma.group.update).not.toHaveBeenCalled();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(nameLookupArgs()).toEqual([]);
    });

    it('does not re-validate an unchanged teacher, even a blocked one', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...teacher,
        status: UserStatus.BLOCKED,
      });

      await service.update(admin as never, 'group-1', {
        name: 'Нова назва',
        teacherId: 'teacher-1',
      });

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.group.update).toHaveBeenCalled();
    });

    it('validates a new teacher and saves it', async () => {
      await service.update(admin as never, 'group-1', {
        teacherId: 'teacher-2',
      });

      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'teacher-2' } }),
      );
      expect(prisma.group.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { teacherId: 'teacher-2' } }),
      );
    });

    it('rejects a new teacher from another organization', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...teacher,
        organizationId: 'org-2',
      });

      const error = await caught(
        service.update(admin as never, 'group-1', { teacherId: 'teacher-2' }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(TEACHER_NOT_FOUND_MESSAGE);
      expect(prisma.group.update).not.toHaveBeenCalled();
    });

    it('checks the date range against the stored startDate', async () => {
      const error = await caught(
        service.update(admin as never, 'group-1', { endDate: '2026-09-30' }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'endDate', message: GROUP_DATE_RANGE_MESSAGE }],
      });
      expect(prisma.group.update).not.toHaveBeenCalled();
    });

    it('checks the date range against the stored endDate', async () => {
      await expect(
        service.update(admin as never, 'group-1', { startDate: '2027-01-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.group.update).not.toHaveBeenCalled();
    });

    it('clears a date when null is sent', async () => {
      await service.update(admin as never, 'group-1', { endDate: null });

      expect(prisma.group.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { endDate: null } }),
      );
    });

    it('excludes the group itself from the name check', async () => {
      await service.update(admin as never, 'group-1', {
        name: 'пдр — група а',
      });

      expect(nameLookupArgs()).toEqual([
        {
          where: {
            organizationId: 'org-1',
            status: { in: [GroupStatus.PLANNED, GroupStatus.ACTIVE] },
            name: { equals: 'пдр — група а', mode: 'insensitive' },
            NOT: { id: 'group-1' },
          },
          select: { id: true },
        },
      ]);
    });

    it('returns 409 when another open group already has the new name', async () => {
      mockGroupLookups({ existing, duplicate: { id: 'group-9' } });

      const error = await caught(
        service.update(admin as never, 'group-1', { name: 'Група В' }),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual({
        statusCode: 409,
        errors: [{ field: 'name', message: GROUP_NAME_TAKEN_MESSAGE }],
      });
      expect(prisma.group.update).not.toHaveBeenCalled();
    });

    it('forbids non-ADMIN roles', async () => {
      await expect(
        service.update(
          { ...admin, role: UserRole.TEACHER } as never,
          'group-1',
          {
            name: 'Нова назва',
          },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('changeStatus', () => {
    const ALLOWED: [GroupStatus, GroupStatus][] = [
      [GroupStatus.PLANNED, GroupStatus.ACTIVE],
      [GroupStatus.PLANNED, GroupStatus.ARCHIVED],
      [GroupStatus.ACTIVE, GroupStatus.COMPLETED],
      [GroupStatus.ACTIVE, GroupStatus.ARCHIVED],
      [GroupStatus.COMPLETED, GroupStatus.ARCHIVED],
    ];
    const statuses = Object.values(GroupStatus);
    const REJECTED = statuses
      .flatMap((from) => statuses.map((to) => [from, to] as const))
      .filter(
        ([from, to]) => !ALLOWED.some(([a, b]) => a === from && b === to),
      );

    function withStatus(status: GroupStatus) {
      mockGroupLookups({ existing: { ...groupRow, status } });
      prisma.group.update.mockImplementation(
        ({ data }: { data: { status: GroupStatus } }) =>
          Promise.resolve({
            ...groupRow,
            status: data.status,
            _count: { enrollments: 0 },
          }),
      );
    }

    it.each(ALLOWED)('allows %s → %s', async (from, to) => {
      withStatus(from);

      await expect(
        service.changeStatus(admin as never, 'group-1', { status: to }),
      ).resolves.toMatchObject({ id: 'group-1', status: to });
      expect(prisma.group.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'group-1' },
          data: { status: to },
        }),
      );
    });

    it.each(REJECTED)('rejects %s → %s with 409', async (from, to) => {
      withStatus(from);

      const error = await caught(
        service.changeStatus(admin as never, 'group-1', { status: to }),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(
        `${GROUP_STATUS_TRANSITION_MESSAGE} ${from} → ${to}.`,
      );
      expect(prisma.group.update).not.toHaveBeenCalled();
      expect(prisma.enrollment.updateMany).not.toHaveBeenCalled();
    });

    it.each([
      [GroupStatus.ACTIVE, GroupStatus.COMPLETED],
      [GroupStatus.ACTIVE, GroupStatus.ARCHIVED],
      [GroupStatus.PLANNED, GroupStatus.ARCHIVED],
    ])(
      'completes ACTIVE enrollments before saving %s → %s',
      async (from, to) => {
        withStatus(from);
        prisma.enrollment.updateMany.mockResolvedValue({ count: 4 });

        const result = await service.changeStatus(admin as never, 'group-1', {
          status: to,
        });

        expect(prisma.enrollment.updateMany).toHaveBeenCalledWith({
          where: { groupId: 'group-1', status: EnrollmentStatus.ACTIVE },
          data: { status: EnrollmentStatus.COMPLETED },
        });
        expect(
          prisma.enrollment.updateMany.mock.invocationCallOrder[0],
        ).toBeLessThan(prisma.group.update.mock.invocationCallOrder[0]);
        expect(result.studentsCount).toBe(0);
        expect(log).toHaveBeenCalledWith(
          `Group status changed groupId=group-1 from=${from} to=${to} completedEnrollments=4 actorId=admin-1 organizationId=org-1`,
        );
      },
    );

    it('leaves enrollments alone when the group stays open', async () => {
      withStatus(GroupStatus.PLANNED);

      await service.changeStatus(admin as never, 'group-1', {
        status: GroupStatus.ACTIVE,
      });

      expect(prisma.enrollment.updateMany).not.toHaveBeenCalled();
    });

    it('returns 404 for a group of another organization', async () => {
      mockGroupLookups({ existing: null });

      const error = await caught(
        service.changeStatus(admin as never, 'group-1', {
          status: GroupStatus.ACTIVE,
        }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(GROUP_NOT_FOUND_MESSAGE);
      const [args] = prisma.group.findFirst.mock.calls[0];
      expect(args.where).toEqual({ id: 'group-1', organizationId: 'org-1' });
      expect(prisma.group.update).not.toHaveBeenCalled();
    });

    it('forbids non-ADMIN roles', async () => {
      await expect(
        service.changeStatus(
          { ...admin, role: UserRole.OWNER } as never,
          'group-1',
          { status: GroupStatus.ACTIVE },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns 404 when the organization is soft-deleted', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        ...organization,
        deletedAt: new Date(),
      });

      await expect(
        service.changeStatus(admin as never, 'group-1', {
          status: GroupStatus.ACTIVE,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
