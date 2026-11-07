import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CarStatus,
  LicenseCategory,
  Prisma,
  Transmission,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CAR_NOT_FOUND_MESSAGE,
  INSTRUCTOR_NOT_ACTIVE_MESSAGE,
  INSTRUCTOR_NOT_FOUND_MESSAGE,
  INSTRUCTOR_ROLE_MESSAGE,
} from '../cars/cars.service';
import {
  CAR_NOT_ASSIGNED_MESSAGE,
  CAR_NOT_AVAILABLE_MESSAGE,
  INSTRUCTOR_CAR_MISMATCH_MESSAGE,
} from '../students/students.service';
import {
  SCHEDULE_RANGE_LENGTH_MESSAGE,
  SCHEDULE_RANGE_ORDER_MESSAGE,
} from './lessons.dto';
import {
  NO_SLOT_FIELDS_MESSAGE,
  PracticeSlotsService,
  SLOT_ALREADY_STARTED_MESSAGE,
  SLOT_IN_PAST_MESSAGE,
  SLOT_NOT_FOUND_MESSAGE,
  SLOT_START_MINUTE_MESSAGE,
} from './practice-slots.service';
import {
  LESSON_SCHEDULE_CONFLICT_MESSAGE,
  candidateWindow,
  lessonSlot,
} from './schedule-conflicts';

async function caught(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('Expected the promise to reject');
}

const NOW = new Date('2026-11-07T10:00:00.000Z');
const DAY_MS = 24 * 60 * 60_000;

function actor(role: UserRole, id = `${role.toLowerCase()}-1`): User {
  return { id, role, organizationId: 'org-1' } as User;
}

describe('PracticeSlotsService', () => {
  const admin = actor(UserRole.ADMIN);
  const instructorActor = actor(UserRole.INSTRUCTOR);

  const organization = {
    id: 'org-1',
    timezone: 'Europe/Kyiv',
    deletedAt: null as Date | null,
  };

  const activeInstructor = {
    organizationId: 'org-1',
    role: UserRole.INSTRUCTOR as UserRole,
    status: UserStatus.ACTIVE as UserStatus,
    deletedAt: null as Date | null,
  };

  const availableCar = {
    organizationId: 'org-1',
    instructorId: 'instructor-1' as string | null,
    status: CarStatus.AVAILABLE as CarStatus,
  };

  function slotRow(overrides: object = {}) {
    return {
      id: 'slot-1',
      instructorId: 'instructor-1',
      carId: 'car-1',
      scheduledAt: new Date('2026-11-16T08:00:00.000Z'),
      durationMin: 60,
      createdAt: new Date('2026-11-01T09:00:00.000Z'),
      updatedAt: new Date('2026-11-01T09:00:00.000Z'),
      instructor: {
        id: 'instructor-1',
        firstName: 'Олег',
        lastName: 'Ткаченко',
      },
      car: {
        id: 'car-1',
        plateNumber: 'AA1234BB',
        category: LicenseCategory.B,
        transmission: Transmission.MANUAL,
      },
      ...overrides,
    };
  }

  const prisma = {
    organization: { findUnique: jest.fn() },
    practiceSlot: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    drivingLesson: { findMany: jest.fn() },
    user: { findUnique: jest.fn() },
    car: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  };

  let service: PracticeSlotsService;
  let log: jest.SpyInstance;

  /** Rebuilds a tagged-template raw query into the final SQL text. */
  function rawSql(mock: jest.Mock, index: number): string {
    const [strings, ...values] = mock.mock.calls[index] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    return Prisma.sql(strings, ...values)
      .text.replace(/\s+/g, ' ')
      .trim();
  }

  function advisoryKeys(): unknown[] {
    return prisma.$executeRaw.mock.calls.map(
      ([, ...values]: [TemplateStringsArray, ...unknown[]]) => values[0],
    );
  }

  function expectNoDatabaseCalls() {
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.practiceSlot.findMany).not.toHaveBeenCalled();
    expect(prisma.practiceSlot.findFirst).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: NOW });
    prisma.organization.findUnique.mockResolvedValue(organization);
    prisma.practiceSlot.findFirst.mockResolvedValue(slotRow());
    prisma.practiceSlot.findMany.mockResolvedValue([]);
    prisma.practiceSlot.create.mockImplementation(
      ({ data }: { data: object }) => Promise.resolve(slotRow(data)),
    );
    prisma.practiceSlot.update.mockImplementation(
      ({ data }: { data: object }) => Promise.resolve(slotRow(data)),
    );
    prisma.practiceSlot.delete.mockResolvedValue(slotRow());
    prisma.drivingLesson.findMany.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue(activeInstructor);
    prisma.car.findUnique.mockResolvedValue(availableCar);
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    service = new PracticeSlotsService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    log.mockRestore();
    jest.useRealTimers();
  });

  describe('create', () => {
    const payload = {
      instructorId: 'instructor-1',
      carId: 'car-1',
      scheduledAt: '2026-11-16T10:00:00+02:00',
    };

    it('creates a slot with the default duration and returns it', async () => {
      const result = await service.create(admin, payload);

      expect(prisma.practiceSlot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            organizationId: 'org-1',
            instructorId: 'instructor-1',
            carId: 'car-1',
            scheduledAt: new Date('2026-11-16T08:00:00.000Z'),
            durationMin: 60,
            createdById: 'admin-1',
          },
        }),
      );
      expect(result).toEqual({
        id: 'slot-1',
        scheduledAt: new Date('2026-11-16T08:00:00.000Z'),
        endsAt: new Date('2026-11-16T09:00:00.000Z'),
        durationMin: 60,
        instructor: {
          id: 'instructor-1',
          firstName: 'Олег',
          lastName: 'Ткаченко',
        },
        car: {
          id: 'car-1',
          plateNumber: 'AA1234BB',
          category: LicenseCategory.B,
          transmission: Transmission.MANUAL,
        },
        createdAt: new Date('2026-11-01T09:00:00.000Z'),
        updatedAt: new Date('2026-11-01T09:00:00.000Z'),
      });
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('Practice slot created slotId=slot-1'),
      );
    });

    it('keeps an explicit duration', async () => {
      await service.create(admin, { ...payload, durationMin: 90 });

      expect(prisma.practiceSlot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ durationMin: 90 }) as unknown,
        }),
      );
    });

    it('takes the instructor and car keys before reading anything', async () => {
      await service.create(admin, payload);

      expect(advisoryKeys()).toEqual(['car:car-1', 'instructor:instructor-1']);
      const lastLock = Math.max(...prisma.$executeRaw.mock.invocationCallOrder);
      expect(lastLock).toBeLessThan(
        prisma.user.findUnique.mock.invocationCallOrder[0],
      );
      expect(lastLock).toBeLessThan(
        prisma.car.findUnique.mock.invocationCallOrder[0],
      );
      expect(lastLock).toBeLessThan(
        prisma.practiceSlot.findMany.mock.invocationCallOrder[0],
      );
    });

    it('looks for conflicts of the new slot without excluding anything', async () => {
      await service.create(admin, payload);

      const interval = lessonSlot(new Date('2026-11-16T08:00:00.000Z'), 60);
      const [slotArgs] = prisma.practiceSlot.findMany.mock.calls[0] as [
        { where: object },
      ];
      expect(slotArgs.where).toEqual({
        organizationId: 'org-1',
        scheduledAt: candidateWindow(interval),
        OR: [{ instructorId: 'instructor-1' }, { carId: 'car-1' }],
      });
    });

    it.each([
      UserRole.INSTRUCTOR,
      UserRole.STUDENT,
      UserRole.TEACHER,
      UserRole.OWNER,
    ])('rejects %s with 403 before touching the database', async (role) => {
      const error = await caught(service.create(actor(role), payload));

      expect(error).toBeInstanceOf(ForbiddenException);
      expectNoDatabaseCalls();
    });

    it.each([
      ['in the past', '2026-11-06T10:00:00Z', SLOT_IN_PAST_MESSAGE],
      ['exactly now', '2026-11-07T10:00:00Z', SLOT_IN_PAST_MESSAGE],
      ['with seconds', '2026-11-16T10:00:30+02:00', SLOT_START_MINUTE_MESSAGE],
      [
        'with milliseconds',
        '2026-11-16T10:00:00.500+02:00',
        SLOT_START_MINUTE_MESSAGE,
      ],
    ])(
      'rejects a start %s with 400 before touching the database',
      async (_, scheduledAt, message) => {
        const error = await caught(
          service.create(admin, { ...payload, scheduledAt }),
        );

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.getResponse()).toEqual({
          statusCode: 400,
          errors: [{ field: 'scheduledAt', message }],
        });
        expectNoDatabaseCalls();
      },
    );

    it('returns 404 for a deleted organization', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        ...organization,
        deletedAt: new Date(),
      });

      const error = await caught(service.create(admin, payload));

      expect(error).toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each([
      ['missing', null],
      [
        'of another organization',
        { ...activeInstructor, organizationId: 'org-2' },
      ],
      ['deleted', { ...activeInstructor, deletedAt: new Date() }],
    ])('returns 404 for an instructor that is %s', async (_, instructor) => {
      prisma.user.findUnique.mockResolvedValue(instructor);

      const error = await caught(service.create(admin, payload));

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(INSTRUCTOR_NOT_FOUND_MESSAGE);
      expect(prisma.practiceSlot.create).not.toHaveBeenCalled();
    });

    it.each([
      [
        'not an INSTRUCTOR',
        { ...activeInstructor, role: UserRole.TEACHER },
        INSTRUCTOR_ROLE_MESSAGE,
      ],
      [
        'BLOCKED',
        { ...activeInstructor, status: UserStatus.BLOCKED },
        INSTRUCTOR_NOT_ACTIVE_MESSAGE,
      ],
    ])(
      'returns 409 for an instructor that is %s',
      async (_, instructor, message) => {
        prisma.user.findUnique.mockResolvedValue(instructor);

        const error = await caught(service.create(admin, payload));

        expect(error).toBeInstanceOf(ConflictException);
        expect(error.message).toBe(message);
        expect(prisma.practiceSlot.create).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['missing', null],
      ['of another organization', { ...availableCar, organizationId: 'org-2' }],
    ])('returns 404 for a car that is %s', async (_, car) => {
      prisma.car.findUnique.mockResolvedValue(car);

      const error = await caught(service.create(admin, payload));

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(CAR_NOT_FOUND_MESSAGE);
    });

    it.each([
      [
        'without an instructor',
        { ...availableCar, instructorId: null },
        CAR_NOT_ASSIGNED_MESSAGE,
      ],
      [
        'of another instructor',
        { ...availableCar, instructorId: 'instructor-2' },
        INSTRUCTOR_CAR_MISMATCH_MESSAGE,
      ],
      [
        'in MAINTENANCE',
        { ...availableCar, status: CarStatus.MAINTENANCE },
        CAR_NOT_AVAILABLE_MESSAGE,
      ],
      [
        'INACTIVE',
        { ...availableCar, status: CarStatus.INACTIVE },
        CAR_NOT_AVAILABLE_MESSAGE,
      ],
    ])('returns 409 for a car %s', async (_, car, message) => {
      prisma.car.findUnique.mockResolvedValue(car);

      const error = await caught(service.create(admin, payload));

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(message);
      expect(prisma.practiceSlot.create).not.toHaveBeenCalled();
    });

    it('returns 409 with every conflict and does not create the slot', async () => {
      prisma.practiceSlot.findMany.mockResolvedValue([
        {
          id: 'slot-2',
          instructorId: 'instructor-1',
          carId: 'car-1',
          scheduledAt: new Date('2026-11-16T08:30:00.000Z'),
          durationMin: 60,
        },
      ]);
      prisma.drivingLesson.findMany.mockResolvedValue([
        {
          id: 'lesson-1',
          instructorId: 'instructor-1',
          carId: 'car-9',
          scheduledAt: new Date('2026-11-16T07:30:00.000Z'),
          durationMin: 60,
        },
      ]);

      const error = await caught(service.create(admin, payload));

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual({
        statusCode: 409,
        error: 'Conflict',
        message: LESSON_SCHEDULE_CONFLICT_MESSAGE,
        conflicts: [
          {
            resource: 'INSTRUCTOR',
            resourceId: 'instructor-1',
            lessonType: 'PRACTICE',
            lessonId: 'lesson-1',
            scheduledAt: new Date('2026-11-16T07:30:00.000Z'),
            endsAt: new Date('2026-11-16T08:30:00.000Z'),
          },
          {
            resource: 'INSTRUCTOR',
            resourceId: 'instructor-1',
            lessonType: 'SLOT',
            lessonId: 'slot-2',
            scheduledAt: new Date('2026-11-16T08:30:00.000Z'),
            endsAt: new Date('2026-11-16T09:30:00.000Z'),
          },
          {
            resource: 'CAR',
            resourceId: 'car-1',
            lessonType: 'SLOT',
            lessonId: 'slot-2',
            scheduledAt: new Date('2026-11-16T08:30:00.000Z'),
            endsAt: new Date('2026-11-16T09:30:00.000Z'),
          },
        ],
      });
      expect(prisma.practiceSlot.create).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining(
          'Practice slot conflict slotId=new conflicts=3',
        ),
      );
    });

    it('accepts a slot that touches another one end to start', async () => {
      prisma.practiceSlot.findMany.mockResolvedValue([
        {
          id: 'slot-2',
          instructorId: 'instructor-1',
          carId: 'car-1',
          scheduledAt: new Date('2026-11-16T07:00:00.000Z'),
          durationMin: 60,
        },
      ]);

      await expect(service.create(admin, payload)).resolves.toMatchObject({
        id: 'slot-1',
      });
    });
  });

  describe('update', () => {
    it('rejects an empty body with 400 before touching the database', async () => {
      const error = await caught(service.update(admin, 'slot-1', {}));

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'body', message: NO_SLOT_FIELDS_MESSAGE }],
      });
      expectNoDatabaseCalls();
    });

    it('rejects a new start in the past with 400 before touching the database', async () => {
      const error = await caught(
        service.update(admin, 'slot-1', {
          scheduledAt: '2026-11-01T10:00:00+02:00',
        }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'scheduledAt', message: SLOT_IN_PAST_MESSAGE }],
      });
      expectNoDatabaseCalls();
    });

    it('rejects INSTRUCTOR with 403', async () => {
      const error = await caught(
        service.update(instructorActor, 'slot-1', { durationMin: 90 }),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expectNoDatabaseCalls();
    });

    it('locks the slot row of the organization before reading it', async () => {
      await service.update(admin, 'slot-1', { durationMin: 90 });

      expect(rawSql(prisma.$queryRaw, 0)).toBe(
        'SELECT id FROM practice_slots WHERE id = $1::uuid AND organization_id = $2::uuid FOR UPDATE',
      );
      expect(prisma.$queryRaw.mock.calls[0].slice(1)).toEqual([
        'slot-1',
        'org-1',
      ]);
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.practiceSlot.findFirst.mock.invocationCallOrder[0],
      );
      expect(prisma.practiceSlot.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'slot-1', organizationId: 'org-1' },
        }),
      );
    });

    it('returns 404 for a slot of another organization', async () => {
      prisma.practiceSlot.findFirst.mockResolvedValue(null);

      const error = await caught(
        service.update(admin, 'slot-1', { durationMin: 90 }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(SLOT_NOT_FOUND_MESSAGE);
    });

    it.each([
      ['already started', new Date('2026-11-07T09:30:00.000Z')],
      ['starting right now', NOW],
    ])('returns 409 for a slot %s', async (_, scheduledAt) => {
      prisma.practiceSlot.findFirst.mockResolvedValue(slotRow({ scheduledAt }));

      const error = await caught(
        service.update(admin, 'slot-1', { durationMin: 90 }),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(SLOT_ALREADY_STARTED_MESSAGE);
      expect(prisma.practiceSlot.update).not.toHaveBeenCalled();
    });

    it('changes only the duration and excludes the slot itself from conflicts', async () => {
      const result = await service.update(admin, 'slot-1', { durationMin: 90 });

      expect(prisma.practiceSlot.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'slot-1' },
          data: { durationMin: 90 },
        }),
      );
      const [slotArgs] = prisma.practiceSlot.findMany.mock.calls[0] as [
        { where: { id: unknown } },
      ];
      expect(slotArgs.where.id).toEqual({ not: 'slot-1' });
      expect(result.endsAt).toEqual(new Date('2026-11-16T09:30:00.000Z'));
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining(
          'Practice slot updated slotId=slot-1 fields=durationMin',
        ),
      );
    });

    it('moves the slot and checks the new interval', async () => {
      await service.update(admin, 'slot-1', {
        scheduledAt: '2026-11-16T12:00:00+02:00',
      });

      expect(prisma.practiceSlot.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { scheduledAt: new Date('2026-11-16T10:00:00.000Z') },
        }),
      );
      const interval = lessonSlot(new Date('2026-11-16T10:00:00.000Z'), 60);
      const [lessonArgs] = prisma.drivingLesson.findMany.mock.calls[0] as [
        { where: { scheduledAt: unknown } },
      ];
      expect(lessonArgs.where.scheduledAt).toEqual(candidateWindow(interval));
    });

    it('rejects a new instructor when the slot car belongs to the old one', async () => {
      prisma.user.findUnique.mockResolvedValue(activeInstructor);

      const error = await caught(
        service.update(admin, 'slot-1', { instructorId: 'instructor-2' }),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(INSTRUCTOR_CAR_MISMATCH_MESSAGE);
      expect(advisoryKeys()).toEqual(['car:car-1', 'instructor:instructor-2']);
      expect(prisma.practiceSlot.update).not.toHaveBeenCalled();
    });

    it('changes instructor and car together', async () => {
      prisma.car.findUnique.mockResolvedValue({
        ...availableCar,
        instructorId: 'instructor-2',
      });

      await service.update(admin, 'slot-1', {
        instructorId: 'instructor-2',
        carId: 'car-2',
      });

      expect(prisma.practiceSlot.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { instructorId: 'instructor-2', carId: 'car-2' },
        }),
      );
    });

    it('returns the slot without writing when nothing changes', async () => {
      const result = await service.update(admin, 'slot-1', {
        durationMin: 60,
        carId: 'car-1',
      });

      expect(result.id).toBe('slot-1');
      expect(prisma.practiceSlot.update).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    });

    it('returns 409 when the new interval conflicts', async () => {
      prisma.practiceSlot.findMany.mockResolvedValue([
        {
          id: 'slot-2',
          instructorId: 'instructor-1',
          carId: 'car-2',
          scheduledAt: new Date('2026-11-16T09:00:00.000Z'),
          durationMin: 60,
        },
      ]);

      const error = await caught(
        service.update(admin, 'slot-1', { durationMin: 90 }),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining(
          'Practice slot conflict slotId=slot-1 conflicts=1',
        ),
      );
      expect(prisma.practiceSlot.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('locks and deletes a future slot', async () => {
      await expect(service.remove(admin, 'slot-1')).resolves.toBeUndefined();

      expect(rawSql(prisma.$queryRaw, 0)).toContain('FROM practice_slots');
      expect(prisma.practiceSlot.delete).toHaveBeenCalledWith({
        where: { id: 'slot-1' },
      });
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('Practice slot deleted slotId=slot-1'),
      );
    });

    it('returns 409 for a slot that already started', async () => {
      prisma.practiceSlot.findFirst.mockResolvedValue(
        slotRow({ scheduledAt: new Date('2026-11-07T09:00:00.000Z') }),
      );

      const error = await caught(service.remove(admin, 'slot-1'));

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(SLOT_ALREADY_STARTED_MESSAGE);
      expect(prisma.practiceSlot.delete).not.toHaveBeenCalled();
    });

    it('returns 404 for a slot of another organization', async () => {
      prisma.practiceSlot.findFirst.mockResolvedValue(null);

      const error = await caught(service.remove(admin, 'slot-1'));

      expect(error).toBeInstanceOf(NotFoundException);
      expect(prisma.practiceSlot.delete).not.toHaveBeenCalled();
    });

    it('rejects INSTRUCTOR with 403', async () => {
      const error = await caught(service.remove(instructorActor, 'slot-1'));

      expect(error).toBeInstanceOf(ForbiddenException);
      expectNoDatabaseCalls();
    });
  });

  describe('list', () => {
    function where(): { AND: object[] } {
      const [args] = prisma.practiceSlot.findMany.mock.calls[0] as [
        { where: { AND: object[] } },
      ];
      return args.where;
    }

    it('defaults to 30 days from now and returns the school timezone', async () => {
      const result = await service.list(admin, {});

      const range = { start: NOW, end: new Date(NOW.getTime() + 30 * DAY_MS) };
      expect(result).toEqual({
        from: range.start,
        to: range.end,
        timezone: 'Europe/Kyiv',
        items: [],
      });
      expect(where()).toEqual({
        AND: [
          { organizationId: 'org-1' },
          { scheduledAt: candidateWindow(range) },
        ],
      });
      expect(prisma.practiceSlot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        }),
      );
    });

    it('filters by instructor and car for ADMIN', async () => {
      await service.list(admin, {
        instructorId: 'instructor-2',
        carId: 'car-2',
      });

      expect(where().AND).toEqual(
        expect.arrayContaining([
          { instructorId: 'instructor-2' },
          { carId: 'car-2' },
        ]),
      );
    });

    it('shows INSTRUCTOR only their own slots', async () => {
      await service.list(instructorActor, {});

      expect(where().AND).toContainEqual({ instructorId: 'instructor-1' });
    });

    it('accepts INSTRUCTOR passing their own id', async () => {
      await service.list(instructorActor, { instructorId: 'instructor-1' });

      expect(where().AND).toContainEqual({ instructorId: 'instructor-1' });
    });

    it('rejects INSTRUCTOR asking for another instructor with 403', async () => {
      const error = await caught(
        service.list(instructorActor, { instructorId: 'instructor-2' }),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expectNoDatabaseCalls();
    });

    it.each([UserRole.STUDENT, UserRole.TEACHER, UserRole.OWNER])(
      'rejects %s with 403',
      async (role) => {
        const error = await caught(service.list(actor(role), {}));

        expect(error).toBeInstanceOf(ForbiddenException);
        expectNoDatabaseCalls();
      },
    );

    it('keeps slots that overlap the window and drops the rest', async () => {
      prisma.practiceSlot.findMany.mockResolvedValue([
        // 23:00–00:30 across the window start: overlaps.
        slotRow({
          id: 'slot-across',
          scheduledAt: new Date('2026-11-15T22:30:00.000Z'),
          durationMin: 120,
        }),
        // Ends exactly at the window start: does not overlap.
        slotRow({
          id: 'slot-before',
          scheduledAt: new Date('2026-11-15T22:00:00.000Z'),
          durationMin: 60,
        }),
        slotRow({ id: 'slot-inside' }),
      ]);

      const result = await service.list(admin, {
        from: '2026-11-16T01:00:00+02:00',
        to: '2026-11-17T00:00:00+02:00',
      });

      expect(result.items.map((item) => item.id)).toEqual([
        'slot-across',
        'slot-inside',
      ]);
    });

    it.each([
      [
        'to before from',
        { from: '2026-11-17T00:00:00Z', to: '2026-11-16T00:00:00Z' },
        SCHEDULE_RANGE_ORDER_MESSAGE,
      ],
      [
        'a window longer than 62 days',
        { from: '2026-11-16T00:00:00Z', to: '2027-02-16T00:00:00Z' },
        SCHEDULE_RANGE_LENGTH_MESSAGE,
      ],
    ])('rejects %s with 400', async (_, query, message) => {
      const error = await caught(service.list(admin, query));

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'to', message }],
      });
      expectNoDatabaseCalls();
    });
  });

  describe('findOne', () => {
    it('returns a slot of the organization to ADMIN', async () => {
      const result = await service.findOne(admin, 'slot-1');

      expect(result.id).toBe('slot-1');
      expect(prisma.practiceSlot.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'slot-1', organizationId: 'org-1' },
        }),
      );
    });

    it('returns their own slot to INSTRUCTOR', async () => {
      await expect(
        service.findOne(instructorActor, 'slot-1'),
      ).resolves.toMatchObject({ id: 'slot-1' });
    });

    it("rejects INSTRUCTOR opening another instructor's slot with 403", async () => {
      prisma.practiceSlot.findFirst.mockResolvedValue(
        slotRow({ instructorId: 'instructor-2' }),
      );

      const error = await caught(service.findOne(instructorActor, 'slot-1'));

      expect(error).toBeInstanceOf(ForbiddenException);
    });

    it('returns 404 for a slot of another organization', async () => {
      prisma.practiceSlot.findFirst.mockResolvedValue(null);

      const error = await caught(service.findOne(admin, 'slot-1'));

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(SLOT_NOT_FOUND_MESSAGE);
    });

    it('rejects STUDENT with 403', async () => {
      const error = await caught(
        service.findOne(actor(UserRole.STUDENT), 'slot-1'),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expectNoDatabaseCalls();
    });
  });
});
