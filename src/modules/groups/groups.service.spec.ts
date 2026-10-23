import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CourseStatus,
  EnrollmentStatus,
  GroupStatus,
  LessonStatus,
  OrganizationStatus,
  Prisma,
  TrainingStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  GROUP_NOT_ASSIGNABLE_MESSAGE,
  STUDENT_ACTIVE_GROUP_MESSAGE,
  STUDENT_NOT_FOUND_MESSAGE,
  STUDENT_NOT_IN_GROUP_MESSAGE,
  StudentsService,
} from '../students/students.service';
import {
  COURSE_ARCHIVED_MESSAGE,
  COURSE_NOT_FOUND_MESSAGE,
  GROUP_CLOSED_CANCELLATION_REASON,
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
    courseId: null as string | null,
    createdAt: new Date('2026-09-29T19:20:00.000Z'),
    updatedAt: new Date('2026-09-30T08:00:00.000Z'),
    teacher: { id: 'teacher-1', firstName: 'Ірина', lastName: 'Мельник' },
    course: null as { id: string; name: string } | null,
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
    course: { findFirst: jest.fn() },
    enrollment: { updateMany: jest.fn(), findMany: jest.fn() },
    lesson: { updateMany: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };

  const studentsService = {
    assignGroup: jest.fn(),
    removeFromGroup: jest.fn(),
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
    prisma.enrollment.findMany.mockResolvedValue([]);
    prisma.lesson.updateMany.mockResolvedValue({ count: 0 });
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.course.findFirst.mockResolvedValue({ status: CourseStatus.ACTIVE });
    studentsService.assignGroup.mockResolvedValue({});
    studentsService.removeFromGroup.mockResolvedValue(undefined);
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    mockGroupLookups({});
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    service = new GroupsService(
      prisma as unknown as PrismaService,
      studentsService as unknown as StudentsService,
    );
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
          course: null,
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

  it('selects only the course id and name', async () => {
    await service.list(admin as never);

    const [args] = prisma.group.findMany.mock.calls[0];
    expect(args.include.course).toEqual({
      select: { id: true, name: true },
    });
  });

  it('maps an assigned course into the list item', async () => {
    const course = { id: 'course-1', name: 'Теоретичний курс, категорія B' };
    prisma.group.findMany.mockResolvedValue([
      { ...groupRow, courseId: 'course-1', course },
    ]);

    const { groups } = await service.list(admin as never);

    expect(groups[0].course).toEqual(course);
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
        course: null,
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
          course: { select: { id: true, name: true } },
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

    it('locks the group row FOR UPDATE inside the actor organization before reading it', async () => {
      withStatus(GroupStatus.ACTIVE);

      await service.changeStatus(admin as never, 'group-1', {
        status: GroupStatus.COMPLETED,
      });

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.$queryRaw).toHaveBeenCalledWith(
        expect.anything(),
        'group-1',
        'org-1',
        Prisma.sql`FOR UPDATE`,
      );
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.group.findFirst.mock.invocationCallOrder[0],
      );
    });

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
      expect(error.getResponse()).toEqual({
        statusCode: 409,
        message: `${GROUP_STATUS_TRANSITION_MESSAGE} ${from} → ${to}.`,
        error: 'Conflict',
        currentStatus: from,
      });
      expect(prisma.group.update).not.toHaveBeenCalled();
      expect(prisma.enrollment.updateMany).not.toHaveBeenCalled();
      expect(prisma.lesson.updateMany).not.toHaveBeenCalled();
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
        prisma.lesson.updateMany.mockResolvedValue({ count: 2 });

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
          `Group status changed groupId=group-1 from=${from} to=${to} completedEnrollments=4 cancelledLessons=2 actorId=admin-1 organizationId=org-1`,
        );
      },
    );

    it.each([
      [GroupStatus.ACTIVE, GroupStatus.COMPLETED],
      [GroupStatus.ACTIVE, GroupStatus.ARCHIVED],
      [GroupStatus.PLANNED, GroupStatus.ARCHIVED],
      [GroupStatus.COMPLETED, GroupStatus.ARCHIVED],
    ])(
      'cancels only future SCHEDULED lessons before saving %s → %s',
      async (from, to) => {
        withStatus(from);

        const before = Date.now();
        await service.changeStatus(admin as never, 'group-1', { status: to });
        const after = Date.now();

        expect(prisma.lesson.updateMany).toHaveBeenCalledTimes(1);
        const [args] = prisma.lesson.updateMany.mock.calls[0] as [
          {
            where: { scheduledAt: { gte: Date } };
            data: { cancelledAt: Date };
          },
        ];
        expect(args).toEqual({
          where: {
            groupId: 'group-1',
            status: LessonStatus.SCHEDULED,
            scheduledAt: { gte: expect.any(Date) },
          },
          data: {
            status: LessonStatus.CANCELLED,
            cancelledAt: expect.any(Date),
            cancelledById: 'admin-1',
            cancellationReason: GROUP_CLOSED_CANCELLATION_REASON,
          },
        });
        const cutoff = args.where.scheduledAt.gte.getTime();
        expect(cutoff).toBeGreaterThanOrEqual(before);
        expect(cutoff).toBeLessThanOrEqual(after);
        // Скасовано в той самий момент, що й межа «майбутніх» занять.
        expect(args.data.cancelledAt.getTime()).toBe(cutoff);
        expect(
          prisma.lesson.updateMany.mock.invocationCallOrder[0],
        ).toBeLessThan(prisma.group.update.mock.invocationCallOrder[0]);
      },
    );

    it('leaves enrollments and lessons alone when the group stays open', async () => {
      withStatus(GroupStatus.PLANNED);

      await service.changeStatus(admin as never, 'group-1', {
        status: GroupStatus.ACTIVE,
      });

      expect(prisma.enrollment.updateMany).not.toHaveBeenCalled();
      expect(prisma.lesson.updateMany).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(
        'Group status changed groupId=group-1 from=PLANNED to=ACTIVE completedEnrollments=0 cancelledLessons=0 actorId=admin-1 organizationId=org-1',
      );
    });

    it('rejects a request that reads the status saved by a concurrent change', async () => {
      // After the lock is released the second request reads ARCHIVED, which a
      // concurrent ACTIVE → ARCHIVED just saved, so ARCHIVED → COMPLETED fails.
      withStatus(GroupStatus.ARCHIVED);

      const error = await caught(
        service.changeStatus(admin as never, 'group-1', {
          status: GroupStatus.COMPLETED,
        }),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({
        currentStatus: GroupStatus.ARCHIVED,
      });
      expect(prisma.group.update).not.toHaveBeenCalled();
    });

    it('returns 404 for a group of another organization', async () => {
      mockGroupLookups({ existing: null });

      const error = await caught(
        service.changeStatus(admin as never, 'group-1', {
          status: GroupStatus.ARCHIVED,
        }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(GROUP_NOT_FOUND_MESSAGE);
      const [args] = prisma.group.findFirst.mock.calls[0];
      expect(args.where).toEqual({ id: 'group-1', organizationId: 'org-1' });
      expect(prisma.$queryRaw).toHaveBeenCalledWith(
        expect.anything(),
        'group-1',
        'org-1',
        Prisma.sql`FOR UPDATE`,
      );
      expect(prisma.group.update).not.toHaveBeenCalled();
      expect(prisma.enrollment.updateMany).not.toHaveBeenCalled();
      expect(prisma.lesson.updateMany).not.toHaveBeenCalled();
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
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
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

  describe('assignCourse', () => {
    const course = { id: 'course-1', name: 'Теоретичний курс, категорія B' };

    function withGroup(
      overrides: {
        status?: GroupStatus;
        courseId?: string | null;
        course?: { id: string; name: string } | null;
      } = {},
    ) {
      mockGroupLookups({ existing: { ...groupRow, ...overrides } });
      prisma.group.update.mockImplementation(
        ({ data }: { data: { courseId: string | null } }) =>
          Promise.resolve({
            ...groupRow,
            ...overrides,
            courseId: data.courseId,
            course: data.courseId ? { ...course, id: data.courseId } : null,
          }),
      );
    }

    beforeEach(() => {
      withGroup();
    });

    it('assigns an ACTIVE course of the organization and returns the group with it', async () => {
      const result = await service.assignCourse(admin as never, 'group-1', {
        courseId: 'course-1',
      });

      expect(result).toEqual({
        id: 'group-1',
        name: 'ПДР — Група А',
        status: GroupStatus.ACTIVE,
        startDate: new Date('2026-10-01T00:00:00.000Z'),
        endDate: null,
        teacher: { id: 'teacher-1', firstName: 'Ірина', lastName: 'Мельник' },
        course,
        studentsCount: 3,
        createdAt: new Date('2026-09-29T19:20:00.000Z'),
      });
      expect(prisma.course.findFirst).toHaveBeenCalledWith({
        where: { id: 'course-1', organizationId: 'org-1' },
        select: { status: true },
      });
      expect(prisma.group.update).toHaveBeenCalledWith({
        where: { id: 'group-1' },
        data: { courseId: 'course-1' },
        include: {
          teacher: { select: { id: true, firstName: true, lastName: true } },
          course: { select: { id: true, name: true } },
          _count: {
            select: {
              enrollments: { where: { status: EnrollmentStatus.ACTIVE } },
            },
          },
        },
      });
      expect(log).toHaveBeenCalledWith(
        'Group course assigned groupId=group-1 courseId=course-1 actorId=admin-1 organizationId=org-1',
      );
    });

    it('replaces the current course with another one', async () => {
      withGroup({
        courseId: 'course-old',
        course: { id: 'course-old', name: 'Старий' },
      });

      const result = await service.assignCourse(admin as never, 'group-1', {
        courseId: 'course-1',
      });

      expect(result.course).toEqual(course);
      expect(prisma.group.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { courseId: 'course-1' } }),
      );
    });

    it('also assigns a course to a PLANNED group', async () => {
      withGroup({ status: GroupStatus.PLANNED });

      await expect(
        service.assignCourse(admin as never, 'group-1', {
          courseId: 'course-1',
        }),
      ).resolves.toMatchObject({ course });
    });

    it('removes the course with null without looking a course up', async () => {
      withGroup({ courseId: 'course-1', course });

      const result = await service.assignCourse(admin as never, 'group-1', {
        courseId: null,
      });

      expect(result.course).toBeNull();
      expect(prisma.course.findFirst).not.toHaveBeenCalled();
      expect(prisma.group.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { courseId: null } }),
      );
      expect(log).toHaveBeenCalledWith(
        'Group course assigned groupId=group-1 courseId=none actorId=admin-1 organizationId=org-1',
      );
    });

    it('skips the write when the same course is sent again', async () => {
      withGroup({ courseId: 'course-1', course });

      await expect(
        service.assignCourse(admin as never, 'group-1', {
          courseId: 'course-1',
        }),
      ).resolves.toMatchObject({ course });
      expect(prisma.course.findFirst).not.toHaveBeenCalled();
      expect(prisma.group.update).not.toHaveBeenCalled();
    });

    it('skips the write when null is sent for a group without a course', async () => {
      await expect(
        service.assignCourse(admin as never, 'group-1', { courseId: null }),
      ).resolves.toMatchObject({ course: null });
      expect(prisma.group.update).not.toHaveBeenCalled();
    });

    it('returns 404 for a missing course or a course of another organization', async () => {
      prisma.course.findFirst.mockResolvedValue(null);

      const error = await caught(
        service.assignCourse(admin as never, 'group-1', {
          courseId: 'course-foreign',
        }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(COURSE_NOT_FOUND_MESSAGE);
      expect(prisma.course.findFirst).toHaveBeenCalledWith({
        where: { id: 'course-foreign', organizationId: 'org-1' },
        select: { status: true },
      });
      expect(prisma.group.update).not.toHaveBeenCalled();
    });

    it('returns 409 for an ARCHIVED course', async () => {
      prisma.course.findFirst.mockResolvedValue({
        status: CourseStatus.ARCHIVED,
      });

      const error = await caught(
        service.assignCourse(admin as never, 'group-1', {
          courseId: 'course-1',
        }),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(COURSE_ARCHIVED_MESSAGE);
      expect(prisma.group.update).not.toHaveBeenCalled();
    });

    it.each([GroupStatus.COMPLETED, GroupStatus.ARCHIVED])(
      'returns 409 for a %s group before looking the course up',
      async (status) => {
        withGroup({ status });

        for (const courseId of ['course-1', null]) {
          const error = await caught(
            service.assignCourse(admin as never, 'group-1', { courseId }),
          );

          expect(error).toBeInstanceOf(ConflictException);
          expect(error.message).toBe(GROUP_CLOSED_MESSAGE);
        }
        expect(prisma.course.findFirst).not.toHaveBeenCalled();
        expect(prisma.group.update).not.toHaveBeenCalled();
      },
    );

    it('returns 404 for a group of another organization', async () => {
      mockGroupLookups({ existing: null });

      const error = await caught(
        service.assignCourse(admin as never, 'group-1', {
          courseId: 'course-1',
        }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(GROUP_NOT_FOUND_MESSAGE);
      const [args] = prisma.group.findFirst.mock.calls[0];
      expect(args.where).toEqual({ id: 'group-1', organizationId: 'org-1' });
      expect(prisma.course.findFirst).not.toHaveBeenCalled();
    });

    it.each([
      UserRole.OWNER,
      UserRole.TEACHER,
      UserRole.INSTRUCTOR,
      UserRole.STUDENT,
    ])('forbids %s without touching the database', async (role) => {
      await expect(
        service.assignCourse({ ...admin, role } as never, 'group-1', {
          courseId: 'course-1',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.organization.findUnique).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns 404 when the organization is soft-deleted', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        ...organization,
        deletedAt: new Date(),
      });

      await expect(
        service.assignCourse(admin as never, 'group-1', {
          courseId: 'course-1',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('group roster', () => {
    const teacherActor = {
      id: 'teacher-1',
      role: UserRole.TEACHER,
      organizationId: 'org-1',
    };

    const enrollmentRow = {
      enrolledAt: new Date('2026-10-02T09:00:00.000Z'),
      student: {
        id: 'student-1',
        firstName: 'Олена',
        lastName: 'Коваль',
        email: 'student@example.com',
        phone: '+380991234567',
        studentProfile: { trainingStatus: TrainingStatus.ACTIVE },
      },
    };

    const rosterStudent = {
      id: 'student-1',
      firstName: 'Олена',
      lastName: 'Коваль',
      email: 'student@example.com',
      phone: '+380991234567',
      trainingStatus: TrainingStatus.ACTIVE,
      enrolledAt: new Date('2026-10-02T09:00:00.000Z'),
    };

    const groupItem = {
      id: 'group-1',
      name: 'ПДР — Група А',
      status: GroupStatus.ACTIVE,
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: null,
      teacher: { id: 'teacher-1', firstName: 'Ірина', lastName: 'Мельник' },
      course: null,
      studentsCount: 1,
      createdAt: new Date('2026-09-29T19:20:00.000Z'),
    };

    beforeEach(() => {
      mockGroupLookups({
        existing: { ...groupRow, _count: { enrollments: 1 } },
      });
      prisma.enrollment.findMany.mockResolvedValue([enrollmentRow]);
    });

    describe('listStudents', () => {
      it('returns the group and its active students for ADMIN', async () => {
        await expect(
          service.listStudents(admin as never, 'group-1'),
        ).resolves.toEqual({ group: groupItem, students: [rosterStudent] });

        const [groupArgs] = prisma.group.findFirst.mock.calls[0];
        expect(groupArgs.where).toEqual({
          id: 'group-1',
          organizationId: 'org-1',
        });
      });

      it('reads only ACTIVE enrollments of the organization with safe student fields', async () => {
        await service.listStudents(admin as never, 'group-1');

        expect(prisma.enrollment.findMany).toHaveBeenCalledWith({
          where: {
            groupId: 'group-1',
            status: EnrollmentStatus.ACTIVE,
            student: { organizationId: 'org-1' },
          },
          select: {
            enrolledAt: true,
            student: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                studentProfile: { select: { trainingStatus: true } },
              },
            },
          },
          orderBy: [
            { student: { lastName: 'asc' } },
            { student: { firstName: 'asc' } },
            { student: { id: 'asc' } },
          ],
        });
      });

      it('maps a student without a profile to a null trainingStatus', async () => {
        prisma.enrollment.findMany.mockResolvedValue([
          {
            ...enrollmentRow,
            student: { ...enrollmentRow.student, studentProfile: null },
          },
        ]);

        const result = await service.listStudents(admin as never, 'group-1');

        expect(result.students).toEqual([
          { ...rosterStudent, trainingStatus: null },
        ]);
      });

      it('lets a TEACHER read the roster of their own group', async () => {
        await expect(
          service.listStudents(teacherActor as never, 'group-1'),
        ).resolves.toEqual({ group: groupItem, students: [rosterStudent] });
      });

      it('returns 403 to a TEACHER of another group without reading students', async () => {
        const error = await caught(
          service.listStudents(
            { ...teacherActor, id: 'teacher-2' } as never,
            'group-1',
          ),
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(prisma.enrollment.findMany).not.toHaveBeenCalled();
      });

      it.each([UserRole.STUDENT, UserRole.INSTRUCTOR, UserRole.OWNER])(
        'returns 403 to %s without touching the database',
        async (role) => {
          await expect(
            service.listStudents({ ...admin, role } as never, 'group-1'),
          ).rejects.toBeInstanceOf(ForbiddenException);
          expect(prisma.organization.findUnique).not.toHaveBeenCalled();
          expect(prisma.group.findFirst).not.toHaveBeenCalled();
          expect(prisma.enrollment.findMany).not.toHaveBeenCalled();
        },
      );

      it('returns 404 for a missing group or a group of another organization', async () => {
        mockGroupLookups({ existing: null });

        const error = await caught(
          service.listStudents(admin as never, 'group-1'),
        );

        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.message).toBe(GROUP_NOT_FOUND_MESSAGE);
        expect(prisma.enrollment.findMany).not.toHaveBeenCalled();
      });

      it('returns 404 when the organization is soft-deleted', async () => {
        prisma.organization.findUnique.mockResolvedValue({
          ...organization,
          deletedAt: new Date(),
        });

        await expect(
          service.listStudents(admin as never, 'group-1'),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.group.findFirst).not.toHaveBeenCalled();
      });
    });

    describe('addStudent', () => {
      const payload = { studentId: 'student-1' };

      it('checks the group, delegates to assignGroup and returns the current roster', async () => {
        await expect(
          service.addStudent(admin as never, 'group-1', payload),
        ).resolves.toEqual({ group: groupItem, students: [rosterStudent] });

        expect(studentsService.assignGroup).toHaveBeenCalledWith(
          admin,
          'student-1',
          { groupId: 'group-1' },
        );
        // The URL group is validated before assignGroup, and the roster is read after it.
        const groupLookups = prisma.group.findFirst.mock.invocationCallOrder;
        const assignCall =
          studentsService.assignGroup.mock.invocationCallOrder[0];
        expect(groupLookups[0]).toBeLessThan(assignCall);
        expect(groupLookups[1]).toBeGreaterThan(assignCall);
        expect(
          prisma.enrollment.findMany.mock.invocationCallOrder[0],
        ).toBeGreaterThan(assignCall);
        expect(log).toHaveBeenCalledWith(
          'Student added to group studentId=student-1 groupId=group-1 actorId=admin-1 organizationId=org-1',
        );
      });

      it('returns 404 for a group of another organization before touching the student', async () => {
        mockGroupLookups({ existing: null });

        const error = await caught(
          service.addStudent(admin as never, 'group-1', payload),
        );

        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.message).toBe(GROUP_NOT_FOUND_MESSAGE);
        const [args] = prisma.group.findFirst.mock.calls[0];
        expect(args.where).toEqual({ id: 'group-1', organizationId: 'org-1' });
        expect(studentsService.assignGroup).not.toHaveBeenCalled();
      });

      it.each([
        ['missing student', new NotFoundException(STUDENT_NOT_FOUND_MESSAGE)],
        ['closed group', new ConflictException(GROUP_NOT_ASSIGNABLE_MESSAGE)],
        [
          'student in another open group',
          new ConflictException(STUDENT_ACTIVE_GROUP_MESSAGE),
        ],
      ])('passes the assignGroup error through (%s)', async (_, failure) => {
        studentsService.assignGroup.mockRejectedValue(failure);

        await expect(
          service.addStudent(admin as never, 'group-1', payload),
        ).rejects.toBe(failure);
        expect(prisma.enrollment.findMany).not.toHaveBeenCalled();
      });

      it.each([
        UserRole.OWNER,
        UserRole.TEACHER,
        UserRole.INSTRUCTOR,
        UserRole.STUDENT,
      ])('forbids %s without touching the database', async (role) => {
        await expect(
          service.addStudent({ ...admin, role } as never, 'group-1', payload),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.organization.findUnique).not.toHaveBeenCalled();
        expect(studentsService.assignGroup).not.toHaveBeenCalled();
      });

      it('returns 404 when the organization is soft-deleted', async () => {
        prisma.organization.findUnique.mockResolvedValue({
          ...organization,
          deletedAt: new Date(),
        });

        await expect(
          service.addStudent(admin as never, 'group-1', payload),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(studentsService.assignGroup).not.toHaveBeenCalled();
      });
    });

    describe('removeStudent', () => {
      it('delegates to removeFromGroup and returns the roster without the student', async () => {
        mockGroupLookups({
          existing: { ...groupRow, _count: { enrollments: 0 } },
        });
        prisma.enrollment.findMany.mockResolvedValue([]);

        await expect(
          service.removeStudent(admin as never, 'group-1', 'student-1'),
        ).resolves.toEqual({
          group: { ...groupItem, studentsCount: 0 },
          students: [],
        });

        expect(studentsService.removeFromGroup).toHaveBeenCalledWith(
          admin,
          'student-1',
          'group-1',
        );
        expect(
          prisma.enrollment.findMany.mock.invocationCallOrder[0],
        ).toBeGreaterThan(
          studentsService.removeFromGroup.mock.invocationCallOrder[0],
        );
      });

      it.each([
        ['missing group', new NotFoundException(GROUP_NOT_FOUND_MESSAGE)],
        [
          'student not in the group',
          new NotFoundException(STUDENT_NOT_IN_GROUP_MESSAGE),
        ],
      ])(
        'passes the removeFromGroup error through (%s)',
        async (_, failure) => {
          studentsService.removeFromGroup.mockRejectedValue(failure);

          await expect(
            service.removeStudent(admin as never, 'group-1', 'student-1'),
          ).rejects.toBe(failure);
          expect(prisma.enrollment.findMany).not.toHaveBeenCalled();
        },
      );

      it.each([
        UserRole.OWNER,
        UserRole.TEACHER,
        UserRole.INSTRUCTOR,
        UserRole.STUDENT,
      ])('forbids %s before calling removeFromGroup', async (role) => {
        await expect(
          service.removeStudent(
            { ...admin, role } as never,
            'group-1',
            'student-1',
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(studentsService.removeFromGroup).not.toHaveBeenCalled();
      });
    });
  });
});
