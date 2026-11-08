import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DayOfWeek,
  LessonStatus,
  TimeOffType,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  INSTRUCTOR_NOT_ACTIVE_MESSAGE,
  INSTRUCTOR_NOT_FOUND_MESSAGE,
} from '../cars/cars.service';
import { CreateTimeOffDto } from './instructor-schedule.dto';
import {
  InstructorScheduleService,
  TIME_OFF_DATE_ORDER_MESSAGE,
  TIME_OFF_FORM_MESSAGE,
  TIME_OFF_INSTANT_ORDER_MESSAGE,
  TIME_OFF_IN_PAST_MESSAGE,
  TIME_OFF_LENGTH_MESSAGE,
  TIME_OFF_NOT_FOUND_MESSAGE,
  WORKING_HOURS_LENGTH_MESSAGE,
  WORKING_HOURS_ORDER_MESSAGE,
  WORKING_HOURS_OVERLAP_MESSAGE,
  assertTimeOffShape,
  formatClock,
  normalizeIntervals,
  parseClock,
  resolveTimeOffInterval,
} from './instructor-schedule.service';
import {
  REQUIRED_FIELD_MESSAGE,
  SCHEDULE_RANGE_ORDER_MESSAGE,
} from './lessons.dto';
import {
  LESSON_SCHEDULE_CONFLICT_MESSAGE,
  candidateWindow,
} from './schedule-conflicts';

async function caught(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('Expected the promise to reject');
}

function caughtSync(run: () => unknown): HttpException {
  try {
    run();
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('Expected the call to throw');
}

function fieldErrors(field: string, message: string) {
  return { statusCode: 400, errors: [{ field, message }] };
}

const NOW = new Date('2026-11-07T10:00:00.000Z');
const KYIV = 'Europe/Kyiv';

function actor(role: UserRole, id = `${role.toLowerCase()}-1`): User {
  return { id, role, organizationId: 'org-1' } as User;
}

const { MONDAY, TUESDAY, WEDNESDAY } = DayOfWeek;

describe('parseClock / formatClock', () => {
  it.each([
    ['00:00', 0],
    ['09:00', 540],
    ['13:45', 825],
    ['23:59', 1439],
    ['24:00', 1440],
  ])('%s ↔ %d', (clock, minute) => {
    expect(parseClock(clock)).toBe(minute);
    expect(formatClock(minute)).toBe(clock);
  });
});

describe('normalizeIntervals', () => {
  it('converts to minutes and sorts by weekday, then start', () => {
    expect(
      normalizeIntervals([
        { dayOfWeek: TUESDAY, start: '09:00', end: '18:00' },
        { dayOfWeek: MONDAY, start: '14:00', end: '18:00' },
        { dayOfWeek: MONDAY, start: '09:00', end: '13:00' },
      ]),
    ).toEqual([
      { dayOfWeek: MONDAY, startMinute: 540, endMinute: 780 },
      { dayOfWeek: MONDAY, startMinute: 840, endMinute: 1080 },
      { dayOfWeek: TUESDAY, startMinute: 540, endMinute: 1080 },
    ]);
  });

  it('accepts an empty week', () => {
    expect(normalizeIntervals([])).toEqual([]);
  });

  it('accepts intervals that touch and the same hours on different days', () => {
    expect(
      normalizeIntervals([
        { dayOfWeek: MONDAY, start: '09:00', end: '13:00' },
        { dayOfWeek: MONDAY, start: '13:00', end: '24:00' },
        { dayOfWeek: TUESDAY, start: '09:00', end: '13:00' },
      ]),
    ).toHaveLength(3);
  });

  it.each([
    ['end equals start', '09:00', '09:00', WORKING_HOURS_ORDER_MESSAGE],
    ['end before start', '18:00', '09:00', WORKING_HOURS_ORDER_MESSAGE],
    ['shorter than a lesson', '09:00', '09:14', WORKING_HOURS_LENGTH_MESSAGE],
  ])('rejects %s on the interval path', (_, start, end, message) => {
    const error = caughtSync(() =>
      normalizeIntervals([
        { dayOfWeek: MONDAY, start: '06:00', end: '07:00' },
        { dayOfWeek: TUESDAY, start, end },
      ]),
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toEqual(
      fieldErrors('intervals.1.end', message),
    );
  });

  it('rejects intervals of one day that overlap, pointing at the later item', () => {
    const error = caughtSync(() =>
      normalizeIntervals([
        { dayOfWeek: MONDAY, start: '12:00', end: '18:00' },
        { dayOfWeek: WEDNESDAY, start: '09:00', end: '18:00' },
        { dayOfWeek: MONDAY, start: '09:00', end: '12:30' },
      ]),
    );

    expect(error.getResponse()).toEqual(
      fieldErrors('intervals.2', WORKING_HOURS_OVERLAP_MESSAGE),
    );
  });
});

describe('assertTimeOffShape', () => {
  it.each<[string, CreateTimeOffDto]>([
    ['one whole day', { startDate: '2026-11-20' }],
    ['several whole days', { startDate: '2026-11-20', endDate: '2026-11-22' }],
    ['a full year', { startDate: '2026-11-20', endDate: '2027-11-20' }],
    [
      'part of a day',
      {
        startsAt: '2026-11-20T10:00:00+02:00',
        endsAt: '2026-11-20T12:00:00+02:00',
      },
    ],
  ])('accepts %s', (_, payload) => {
    expect(() => assertTimeOffShape(payload)).not.toThrow();
  });

  it.each<[string, CreateTimeOffDto, string, string]>([
    [
      'neither form',
      { type: TimeOffType.SICK_LEAVE },
      'body',
      TIME_OFF_FORM_MESSAGE,
    ],
    [
      'both forms',
      { startDate: '2026-11-20', endsAt: '2026-11-20T12:00:00+02:00' },
      'body',
      TIME_OFF_FORM_MESSAGE,
    ],
    [
      'endDate alone',
      { endDate: '2026-11-20' },
      'startDate',
      REQUIRED_FIELD_MESSAGE,
    ],
    [
      'endDate before startDate',
      { startDate: '2026-11-20', endDate: '2026-11-19' },
      'endDate',
      TIME_OFF_DATE_ORDER_MESSAGE,
    ],
    [
      'more than a year of days',
      { startDate: '2026-11-20', endDate: '2027-11-21' },
      'endDate',
      TIME_OFF_LENGTH_MESSAGE,
    ],
    [
      'startsAt alone',
      { startsAt: '2026-11-20T10:00:00+02:00' },
      'endsAt',
      REQUIRED_FIELD_MESSAGE,
    ],
    [
      'endsAt alone',
      { endsAt: '2026-11-20T10:00:00+02:00' },
      'startsAt',
      REQUIRED_FIELD_MESSAGE,
    ],
    [
      'endsAt equal to startsAt in another offset',
      { startsAt: '2026-11-20T10:00:00+02:00', endsAt: '2026-11-20T08:00:00Z' },
      'endsAt',
      TIME_OFF_INSTANT_ORDER_MESSAGE,
    ],
    [
      'instants more than a year apart',
      // 366 днів рівно ще можна; на хвилину більше — ні.
      { startsAt: '2026-11-20T10:00:00Z', endsAt: '2027-11-21T10:01:00Z' },
      'endsAt',
      TIME_OFF_LENGTH_MESSAGE,
    ],
  ])('rejects %s', (_, payload, field, message) => {
    const error = caughtSync(() => assertTimeOffShape(payload));

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toEqual(fieldErrors(field, message));
  });
});

describe('resolveTimeOffInterval', () => {
  it('turns one whole day into local midnight to midnight', () => {
    expect(resolveTimeOffInterval({ startDate: '2026-11-20' }, KYIV)).toEqual({
      start: new Date('2026-11-19T22:00:00.000Z'),
      end: new Date('2026-11-20T22:00:00.000Z'),
    });
  });

  it('includes the last day and follows the DST switch inside the range', () => {
    // 25.10 Київ переходить з UTC+3 на UTC+2.
    expect(
      resolveTimeOffInterval(
        { startDate: '2026-10-24', endDate: '2026-10-25' },
        KYIV,
      ),
    ).toEqual({
      start: new Date('2026-10-23T21:00:00.000Z'),
      end: new Date('2026-10-25T22:00:00.000Z'),
    });
  });

  it('keeps exact instants as they are', () => {
    expect(
      resolveTimeOffInterval(
        {
          startsAt: '2026-11-20T10:00:00+02:00',
          endsAt: '2026-11-20T12:00:00+02:00',
        },
        KYIV,
      ),
    ).toEqual({
      start: new Date('2026-11-20T08:00:00.000Z'),
      end: new Date('2026-11-20T10:00:00.000Z'),
    });
  });
});

describe('InstructorScheduleService', () => {
  const admin = actor(UserRole.ADMIN);
  const instructorActor = actor(UserRole.INSTRUCTOR, 'instructor-1');

  const organization = {
    id: 'org-1',
    timezone: KYIV,
    deletedAt: null as Date | null,
  };

  const activeInstructor = {
    organizationId: 'org-1',
    role: UserRole.INSTRUCTOR as UserRole,
    status: UserStatus.ACTIVE as UserStatus,
    deletedAt: null as Date | null,
  };

  function timeOffRow(overrides: object = {}) {
    return {
      id: 'time-off-1',
      instructorId: 'instructor-1',
      type: TimeOffType.SICK_LEAVE,
      reason: null,
      startsAt: new Date('2026-11-19T22:00:00.000Z'),
      endsAt: new Date('2026-11-20T22:00:00.000Z'),
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    };
  }

  const prisma = {
    organization: { findUnique: jest.fn() },
    user: { findUnique: jest.fn(), findFirst: jest.fn() },
    instructorWorkingHours: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    instructorTimeOff: {
      findMany: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    drivingLesson: { findMany: jest.fn() },
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  };

  let service: InstructorScheduleService;
  let log: jest.SpyInstance;

  function advisoryKeys(): unknown[] {
    return prisma.$executeRaw.mock.calls.map(
      ([, ...values]: [TemplateStringsArray, ...unknown[]]) => values[0],
    );
  }

  function expectNoDatabaseCalls() {
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.instructorWorkingHours.findMany).not.toHaveBeenCalled();
    expect(prisma.instructorTimeOff.findMany).not.toHaveBeenCalled();
    expect(prisma.instructorTimeOff.deleteMany).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: NOW });
    prisma.organization.findUnique.mockResolvedValue(organization);
    prisma.user.findUnique.mockResolvedValue(activeInstructor);
    prisma.user.findFirst.mockResolvedValue({ id: 'instructor-1' });
    prisma.instructorWorkingHours.findMany.mockResolvedValue([]);
    prisma.instructorWorkingHours.deleteMany.mockResolvedValue({ count: 0 });
    prisma.instructorWorkingHours.createMany.mockResolvedValue({ count: 0 });
    prisma.instructorTimeOff.findMany.mockResolvedValue([]);
    prisma.instructorTimeOff.create.mockImplementation(
      ({ data }: { data: object }) => Promise.resolve(timeOffRow(data)),
    );
    prisma.instructorTimeOff.deleteMany.mockResolvedValue({ count: 1 });
    prisma.drivingLesson.findMany.mockResolvedValue([]);
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    service = new InstructorScheduleService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    jest.useRealTimers();
    log.mockRestore();
  });

  describe('getWorkingHours', () => {
    it('returns the week as HH:MM in weekday order with the school timezone', async () => {
      prisma.instructorWorkingHours.findMany.mockResolvedValue([
        { dayOfWeek: TUESDAY, startMinute: 540, endMinute: 1080 },
        { dayOfWeek: MONDAY, startMinute: 840, endMinute: 1080 },
        { dayOfWeek: MONDAY, startMinute: 540, endMinute: 780 },
      ]);

      await expect(
        service.getWorkingHours(admin, 'instructor-1'),
      ).resolves.toEqual({
        instructorId: 'instructor-1',
        timezone: KYIV,
        intervals: [
          { dayOfWeek: MONDAY, start: '09:00', end: '13:00' },
          { dayOfWeek: MONDAY, start: '14:00', end: '18:00' },
          { dayOfWeek: TUESDAY, start: '09:00', end: '18:00' },
        ],
      });
      expect(prisma.instructorWorkingHours.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', instructorId: 'instructor-1' },
        select: { dayOfWeek: true, startMinute: true, endMinute: true },
      });
    });

    it('lets an instructor read their own week', async () => {
      await expect(
        service.getWorkingHours(instructorActor, 'instructor-1'),
      ).resolves.toMatchObject({ instructorId: 'instructor-1' });
    });

    it('forbids an instructor reading someone else, before the database', async () => {
      const error = await caught(
        service.getWorkingHours(instructorActor, 'instructor-2'),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expectNoDatabaseCalls();
    });

    it.each([UserRole.STUDENT, UserRole.TEACHER, UserRole.OWNER])(
      'forbids %s',
      async (role) => {
        const error = await caught(
          service.getWorkingHours(actor(role), 'instructor-1'),
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expectNoDatabaseCalls();
      },
    );

    it('answers 404 for a user who is not an instructor of this school', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const error = await caught(
        service.getWorkingHours(admin, 'instructor-1'),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(INSTRUCTOR_NOT_FOUND_MESSAGE);
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'instructor-1',
          organizationId: 'org-1',
          role: UserRole.INSTRUCTOR,
          deletedAt: null,
        },
        select: { id: true },
      });
    });
  });

  describe('replaceWorkingHours', () => {
    const payload = {
      intervals: [
        { dayOfWeek: MONDAY, start: '14:00', end: '18:00' },
        { dayOfWeek: MONDAY, start: '09:00', end: '13:00' },
      ],
    };

    it('replaces the whole week under the instructor key', async () => {
      const result = await service.replaceWorkingHours(
        admin,
        'instructor-1',
        payload,
      );

      expect(advisoryKeys()).toEqual(['instructor:instructor-1']);
      expect(prisma.instructorWorkingHours.deleteMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', instructorId: 'instructor-1' },
      });
      expect(prisma.instructorWorkingHours.createMany).toHaveBeenCalledWith({
        data: [
          {
            organizationId: 'org-1',
            instructorId: 'instructor-1',
            dayOfWeek: MONDAY,
            startMinute: 540,
            endMinute: 780,
          },
          {
            organizationId: 'org-1',
            instructorId: 'instructor-1',
            dayOfWeek: MONDAY,
            startMinute: 840,
            endMinute: 1080,
          },
        ],
      });
      expect(result.intervals).toEqual([
        { dayOfWeek: MONDAY, start: '09:00', end: '13:00' },
        { dayOfWeek: MONDAY, start: '14:00', end: '18:00' },
      ]);
      expect(log).toHaveBeenCalledWith(
        'Working hours replaced instructorId=instructor-1 intervals=2 actorId=admin-1 organizationId=org-1',
      );
    });

    it('clears the week without inserting anything', async () => {
      await service.replaceWorkingHours(admin, 'instructor-1', {
        intervals: [],
      });

      expect(prisma.instructorWorkingHours.deleteMany).toHaveBeenCalled();
      expect(prisma.instructorWorkingHours.createMany).not.toHaveBeenCalled();
    });

    it('validates the intervals before the database', async () => {
      const error = await caught(
        service.replaceWorkingHours(admin, 'instructor-1', {
          intervals: [{ dayOfWeek: MONDAY, start: '18:00', end: '09:00' }],
        }),
      );

      expect(error.getResponse()).toEqual(
        fieldErrors('intervals.0.end', WORKING_HOURS_ORDER_MESSAGE),
      );
      expectNoDatabaseCalls();
    });

    it.each([UserRole.INSTRUCTOR, UserRole.STUDENT, UserRole.OWNER])(
      'forbids %s',
      async (role) => {
        const error = await caught(
          service.replaceWorkingHours(actor(role), 'instructor-1', payload),
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expectNoDatabaseCalls();
      },
    );

    it('refuses an instructor who is not ACTIVE and writes nothing', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeInstructor,
        status: UserStatus.BLOCKED,
      });

      const error = await caught(
        service.replaceWorkingHours(admin, 'instructor-1', payload),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(INSTRUCTOR_NOT_ACTIVE_MESSAGE);
      expect(prisma.instructorWorkingHours.deleteMany).not.toHaveBeenCalled();
    });

    it('answers 404 for an instructor of another school', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeInstructor,
        organizationId: 'org-2',
      });

      const error = await caught(
        service.replaceWorkingHours(admin, 'instructor-1', payload),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(prisma.instructorWorkingHours.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('listTimeOff', () => {
    it('returns time off that overlaps the default window', async () => {
      prisma.instructorTimeOff.findMany.mockResolvedValue([timeOffRow()]);

      const result = await service.listTimeOff(admin, 'instructor-1', {});

      const end = new Date(NOW.getTime() + 30 * 24 * 60 * 60_000);
      expect(prisma.instructorTimeOff.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org-1',
            instructorId: 'instructor-1',
            startsAt: { lt: end },
            endsAt: { gt: NOW },
          },
          orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        }),
      );
      expect(result).toEqual({
        from: NOW,
        to: end,
        timezone: KYIV,
        items: [timeOffRow()],
      });
    });

    it('rejects a reversed window before the database', async () => {
      const error = await caught(
        service.listTimeOff(admin, 'instructor-1', {
          from: '2026-11-20T00:00:00Z',
          to: '2026-11-10T00:00:00Z',
        }),
      );

      expect(error.getResponse()).toEqual(
        fieldErrors('to', SCHEDULE_RANGE_ORDER_MESSAGE),
      );
      expectNoDatabaseCalls();
    });

    it('forbids an instructor reading someone else', async () => {
      const error = await caught(
        service.listTimeOff(instructorActor, 'instructor-2', {}),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expectNoDatabaseCalls();
    });
  });

  describe('createTimeOff', () => {
    const wholeDay = {
      type: TimeOffType.SICK_LEAVE,
      startDate: '2026-11-20',
      reason: 'Лікарняний',
    };

    it('stores whole days as local midnights under the instructor key', async () => {
      const result = await service.createTimeOff(
        admin,
        'instructor-1',
        wholeDay,
      );

      expect(advisoryKeys()).toEqual(['instructor:instructor-1']);
      expect(prisma.instructorTimeOff.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            organizationId: 'org-1',
            instructorId: 'instructor-1',
            startsAt: new Date('2026-11-19T22:00:00.000Z'),
            endsAt: new Date('2026-11-20T22:00:00.000Z'),
            type: TimeOffType.SICK_LEAVE,
            reason: 'Лікарняний',
            createdById: 'admin-1',
          },
        }),
      );
      expect(result.id).toBe('time-off-1');
      expect(log).toHaveBeenCalledWith(
        'Time off created timeOffId=time-off-1 instructorId=instructor-1 type=SICK_LEAVE startsAt=2026-11-19T22:00:00.000Z endsAt=2026-11-20T22:00:00.000Z actorId=admin-1 organizationId=org-1',
      );
    });

    it('lets the database default the type', async () => {
      await service.createTimeOff(admin, 'instructor-1', {
        startsAt: '2026-11-20T10:00:00+02:00',
        endsAt: '2026-11-20T12:00:00+02:00',
      });

      const [{ data }] = prisma.instructorTimeOff.create.mock.calls[0] as [
        { data: { type?: TimeOffType } },
      ];
      expect(data.type).toBeUndefined();
    });

    it('answers 409 with the booked lessons it would cover and saves nothing', async () => {
      prisma.drivingLesson.findMany.mockResolvedValue([
        {
          id: 'lesson-1',
          scheduledAt: new Date('2026-11-20T08:00:00.000Z'),
          durationMin: 60,
        },
      ]);

      const error = await caught(
        service.createTimeOff(admin, 'instructor-1', wholeDay),
      );

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
            scheduledAt: new Date('2026-11-20T08:00:00.000Z'),
            endsAt: new Date('2026-11-20T09:00:00.000Z'),
          },
        ],
      });
      expect(prisma.drivingLesson.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org-1',
            instructorId: 'instructor-1',
            status: LessonStatus.SCHEDULED,
            scheduledAt: candidateWindow({
              start: new Date('2026-11-19T22:00:00.000Z'),
              end: new Date('2026-11-20T22:00:00.000Z'),
            }),
          },
        }),
      );
      expect(prisma.instructorTimeOff.create).not.toHaveBeenCalled();
    });

    it('checks the shape before the database', async () => {
      const error = await caught(
        service.createTimeOff(admin, 'instructor-1', {
          type: TimeOffType.VACATION,
        }),
      );

      expect(error.getResponse()).toEqual(
        fieldErrors('body', TIME_OFF_FORM_MESSAGE),
      );
      expectNoDatabaseCalls();
    });

    it('rejects whole days that are already over', async () => {
      const error = await caught(
        service.createTimeOff(admin, 'instructor-1', {
          startDate: '2026-11-01',
          endDate: '2026-11-06',
        }),
      );

      expect(error.getResponse()).toEqual(
        fieldErrors('endDate', TIME_OFF_IN_PAST_MESSAGE),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('accepts time off that has started but not ended', async () => {
      await service.createTimeOff(admin, 'instructor-1', {
        startDate: '2026-11-05',
        endDate: '2026-11-07',
      });

      expect(prisma.instructorTimeOff.create).toHaveBeenCalled();
    });

    it('rejects exact instants that are already over', async () => {
      const error = await caught(
        service.createTimeOff(admin, 'instructor-1', {
          startsAt: '2026-11-07T08:00:00Z',
          endsAt: '2026-11-07T10:00:00Z',
        }),
      );

      expect(error.getResponse()).toEqual(
        fieldErrors('endsAt', TIME_OFF_IN_PAST_MESSAGE),
      );
    });

    it.each([UserRole.INSTRUCTOR, UserRole.STUDENT, UserRole.OWNER])(
      'forbids %s',
      async (role) => {
        const error = await caught(
          service.createTimeOff(actor(role), 'instructor-1', wholeDay),
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expectNoDatabaseCalls();
      },
    );

    it('answers 404 for a deleted instructor', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeInstructor,
        deletedAt: NOW,
      });

      const error = await caught(
        service.createTimeOff(admin, 'instructor-1', wholeDay),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(prisma.instructorTimeOff.create).not.toHaveBeenCalled();
    });
  });

  describe('removeTimeOff', () => {
    it('deletes only within the instructor and the school', async () => {
      await service.removeTimeOff(admin, 'instructor-1', 'time-off-1');

      expect(prisma.instructorTimeOff.deleteMany).toHaveBeenCalledWith({
        where: {
          id: 'time-off-1',
          instructorId: 'instructor-1',
          organizationId: 'org-1',
        },
      });
      expect(log).toHaveBeenCalledWith(
        'Time off deleted timeOffId=time-off-1 instructorId=instructor-1 actorId=admin-1 organizationId=org-1',
      );
    });

    it('answers 404 when nothing matched', async () => {
      prisma.instructorTimeOff.deleteMany.mockResolvedValue({ count: 0 });

      const error = await caught(
        service.removeTimeOff(admin, 'instructor-1', 'time-off-1'),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(TIME_OFF_NOT_FOUND_MESSAGE);
    });

    it('forbids an instructor', async () => {
      const error = await caught(
        service.removeTimeOff(instructorActor, 'instructor-1', 'time-off-1'),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expectNoDatabaseCalls();
    });
  });
});
