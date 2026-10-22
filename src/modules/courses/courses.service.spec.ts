import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CourseStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  COURSE_NAME_TAKEN_MESSAGE,
  COURSE_NOT_FOUND_MESSAGE,
  CoursesService,
  NO_COURSE_FIELDS_MESSAGE,
} from './courses.service';

async function caught(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('Expected the promise to reject');
}

describe('CoursesService', () => {
  const admin = {
    id: 'admin-1',
    role: UserRole.ADMIN,
    organizationId: 'org-1',
  };

  const organization = { id: 'org-1', deletedAt: null };

  const courseRow = {
    id: 'course-1',
    name: 'Теоретичний курс, категорія B',
    description: 'ПДР та будова автомобіля.',
    status: CourseStatus.ACTIVE,
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    updatedAt: new Date('2026-10-02T10:00:00.000Z'),
  };

  const prisma = {
    organization: { findUnique: jest.fn() },
    course: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  let service: CoursesService;
  let log: jest.SpyInstance;

  // findFirst serves the course itself (selects name) and the duplicate-name
  // check (selects only id). Route each to its own fixture.
  function mockCourseLookups({
    existing = null,
    duplicate = null,
  }: {
    existing?: object | null;
    duplicate?: object | null;
  }) {
    prisma.course.findFirst.mockImplementation(
      (args: { select?: { name?: boolean } }) =>
        Promise.resolve(args.select?.name ? existing : duplicate),
    );
  }

  function nameLookupArgs() {
    return prisma.course.findFirst.mock.calls
      .map(([args]: [{ select?: { name?: boolean }; where: object }]) => args)
      .filter((args) => !args.select?.name);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.organization.findUnique.mockResolvedValue(organization);
    prisma.course.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    mockCourseLookups({});
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    service = new CoursesService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    log.mockRestore();
  });

  it('returns an empty list when the school has no courses', async () => {
    await expect(service.list(admin as never)).resolves.toEqual({
      courses: [],
    });
  });

  it('lists only courses of the admin organization, sorted by name', async () => {
    await service.list(admin as never);

    expect(prisma.course.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      select: { id: true, name: true, status: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  });

  it('returns ACTIVE and ARCHIVED courses with id, name and status only', async () => {
    prisma.course.findMany.mockResolvedValue([
      {
        id: 'course-1',
        name: 'Теоретичний курс, категорія B',
        status: CourseStatus.ACTIVE,
        description: 'internal',
        organizationId: 'org-1',
      },
      {
        id: 'course-2',
        name: 'Старий курс',
        status: CourseStatus.ARCHIVED,
      },
    ]);

    await expect(service.list(admin as never)).resolves.toEqual({
      courses: [
        {
          id: 'course-1',
          name: 'Теоретичний курс, категорія B',
          status: CourseStatus.ACTIVE,
        },
        { id: 'course-2', name: 'Старий курс', status: CourseStatus.ARCHIVED },
      ],
    });
  });

  it.each([
    UserRole.OWNER,
    UserRole.TEACHER,
    UserRole.INSTRUCTOR,
    UserRole.STUDENT,
  ])('forbids %s without touching the database', async (role) => {
    await expect(
      service.list({ ...admin, role } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    expect(prisma.course.findMany).not.toHaveBeenCalled();
  });

  it.each([null, { ...organization, deletedAt: new Date() }])(
    'returns 404 when the organization is missing or soft-deleted (%p)',
    async (found) => {
      prisma.organization.findUnique.mockResolvedValue(found);

      await expect(service.list(admin as never)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.course.findMany).not.toHaveBeenCalled();
    },
  );

  describe('create', () => {
    const payload = {
      name: 'Теоретичний курс, категорія C',
      description: 'Будова вантажівки.',
    };

    beforeEach(() => {
      prisma.course.create.mockResolvedValue({
        ...courseRow,
        id: 'course-2',
        name: payload.name,
        description: payload.description,
      });
    });

    it('creates an ACTIVE course in the actor organization', async () => {
      await expect(service.create(admin as never, payload)).resolves.toEqual({
        id: 'course-2',
        name: payload.name,
        description: payload.description,
        status: CourseStatus.ACTIVE,
        createdAt: courseRow.createdAt,
        updatedAt: courseRow.updatedAt,
      });

      expect(prisma.course.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          name: payload.name,
          description: payload.description,
          status: CourseStatus.ACTIVE,
        },
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      expect(log).toHaveBeenCalledWith(
        'Course created courseId=course-2 organizationId=org-1 actorId=admin-1',
      );
    });

    it('stores a missing description as null', async () => {
      await service.create(admin as never, { name: payload.name });

      const [args] = prisma.course.create.mock.calls[0];
      expect(args.data.description).toBeNull();
    });

    it('returns 409 with a name field error when an active course already has the name', async () => {
      mockCourseLookups({ duplicate: { id: 'course-1' } });

      const error = await caught(service.create(admin as never, payload));

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual({
        statusCode: 409,
        errors: [{ field: 'name', message: COURSE_NAME_TAKEN_MESSAGE }],
      });
      expect(prisma.course.create).not.toHaveBeenCalled();
    });

    it('checks the name case-insensitively among active courses of the organization only', async () => {
      await service.create(admin as never, payload);

      expect(nameLookupArgs()).toEqual([
        {
          where: {
            organizationId: 'org-1',
            status: CourseStatus.ACTIVE,
            name: { equals: payload.name, mode: 'insensitive' },
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
      expect(prisma.$transaction).not.toHaveBeenCalled();
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
    beforeEach(() => {
      mockCourseLookups({ existing: courseRow });
      prisma.course.update.mockImplementation(({ data }: { data: object }) =>
        Promise.resolve({ ...courseRow, ...data }),
      );
    });

    it('rejects an empty body before touching the course', async () => {
      const error = await caught(
        service.update(admin as never, 'course-1', {}),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'body', message: NO_COURSE_FIELDS_MESSAGE }],
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('looks the course up inside the actor organization and returns 404 otherwise', async () => {
      mockCourseLookups({ existing: null });

      const error = await caught(
        service.update(admin as never, 'course-foreign', {
          name: 'Інша назва',
        }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(COURSE_NOT_FOUND_MESSAGE);
      expect(prisma.course.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'course-foreign', organizationId: 'org-1' },
        }),
      );
      expect(prisma.course.update).not.toHaveBeenCalled();
    });

    it('updates the name and description and returns the saved course', async () => {
      const result = await service.update(admin as never, 'course-1', {
        name: 'Курс B (вечірній)',
        description: 'Новий опис',
      });

      expect(prisma.course.update).toHaveBeenCalledWith({
        where: { id: 'course-1' },
        data: { name: 'Курс B (вечірній)', description: 'Новий опис' },
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      expect(result).toMatchObject({
        id: 'course-1',
        name: 'Курс B (вечірній)',
        description: 'Новий опис',
        status: CourseStatus.ACTIVE,
      });
      expect(log).toHaveBeenCalledWith(
        'Course updated courseId=course-1 organizationId=org-1 actorId=admin-1',
      );
    });

    it('clears the description with null', async () => {
      await service.update(admin as never, 'course-1', { description: null });

      expect(prisma.course.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { description: null } }),
      );
    });

    it('does not write when the values are unchanged', async () => {
      await expect(
        service.update(admin as never, 'course-1', {
          name: courseRow.name,
          description: courseRow.description,
        }),
      ).resolves.toEqual(courseRow);
      expect(prisma.course.update).not.toHaveBeenCalled();
    });

    it('checks a new active name case-insensitively, excluding the course itself', async () => {
      await service.update(admin as never, 'course-1', {
        name: 'Курс B (вечірній)',
      });

      expect(nameLookupArgs()).toEqual([
        {
          where: {
            organizationId: 'org-1',
            status: CourseStatus.ACTIVE,
            name: { equals: 'Курс B (вечірній)', mode: 'insensitive' },
            NOT: { id: 'course-1' },
          },
          select: { id: true },
        },
      ]);
    });

    it('returns 409 when another active course already has the name', async () => {
      mockCourseLookups({ existing: courseRow, duplicate: { id: 'course-2' } });

      const error = await caught(
        service.update(admin as never, 'course-1', { name: 'Зайнято' }),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual({
        statusCode: 409,
        errors: [{ field: 'name', message: COURSE_NAME_TAKEN_MESSAGE }],
      });
      expect(prisma.course.update).not.toHaveBeenCalled();
    });

    it('renames an archived course without a uniqueness check', async () => {
      mockCourseLookups({
        existing: { ...courseRow, status: CourseStatus.ARCHIVED },
      });

      await service.update(admin as never, 'course-1', {
        name: 'Архів, нова назва',
      });

      expect(nameLookupArgs()).toEqual([]);
      expect(prisma.course.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { name: 'Архів, нова назва' } }),
      );
    });

    it.each([
      UserRole.OWNER,
      UserRole.TEACHER,
      UserRole.INSTRUCTOR,
      UserRole.STUDENT,
    ])('forbids %s before touching the database', async (role) => {
      await expect(
        service.update({ ...admin, role } as never, 'course-1', {
          name: 'Інша',
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
        service.update(admin as never, 'course-1', { name: 'Інша' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
