import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingConfirmation,
  CarStatus,
  DayOfWeek,
  LessonStatus,
  LicenseCategory,
  PaymentStatus,
  TrainingStatus,
  Transmission,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CAR_NOT_FOUND_MESSAGE,
  INSTRUCTOR_NOT_ACTIVE_MESSAGE,
} from '../cars/cars.service';
import {
  CAR_NOT_AVAILABLE_MESSAGE,
  STUDENT_NOT_FOUND_MESSAGE,
} from '../students/students.service';
import { SCHEDULE_RANGE_ORDER_MESSAGE } from './lessons.dto';
import { STUDENT_NOT_IN_PRACTICE_MESSAGE } from './practice-rules';
import {
  BOOKING_IN_PAST_MESSAGE,
  BOOKING_TOO_SOON_MESSAGE,
  NO_PRACTICE_ACCESS_MESSAGE,
  PRACTICE_PROFILE_INCOMPLETE_MESSAGE,
  PracticeLessonsService,
  SLOT_NOT_OPEN_MESSAGE,
  STUDENT_HAS_ACTIVE_LESSON_MESSAGE,
} from './practice-lessons.service';
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

function fieldErrors(field: string, message: string) {
  return { statusCode: 400, errors: [{ field, message }] };
}

/** Вівторок; слоти — у понеділок 16.11 (Київ, UTC+2). */
const NOW = new Date('2026-11-10T10:00:00.000Z');
const MINUTE_MS = 60_000;
const at = (iso: string) => new Date(iso);

function actor(role: UserRole, id = `${role.toLowerCase()}-1`): User {
  return { id, role, organizationId: 'org-1' } as User;
}

describe('PracticeLessonsService', () => {
  const admin = actor(UserRole.ADMIN);
  const student = actor(UserRole.STUDENT);

  const organization = {
    id: 'org-1',
    timezone: 'Europe/Kyiv',
    deletedAt: null as Date | null,
  };

  /** Рядок practiceStudentSelect: студент з допуском PRACTICE і повним профілем. */
  function studentRow(profile: object = {}) {
    return {
      id: 'student-1',
      firstName: 'Ірина',
      lastName: 'Коваль',
      status: UserStatus.ACTIVE as UserStatus,
      deletedAt: null as Date | null,
      studentProfile: {
        trainingStatus: TrainingStatus.PRACTICE as TrainingStatus,
        category: LicenseCategory.B as LicenseCategory | null,
        transmission: Transmission.MANUAL as Transmission | null,
        instructorId: 'instructor-1' as string | null,
        carId: 'car-1' as string | null,
        ...profile,
      },
    };
  }

  const instructorPerson = {
    id: 'instructor-1',
    firstName: 'Олег',
    lastName: 'Ткаченко',
  };
  const carView = {
    id: 'car-1',
    plateNumber: 'AA1234BB',
    category: LicenseCategory.B,
    transmission: Transmission.MANUAL,
  };

  function lessonRow(overrides: object = {}) {
    return {
      id: 'lesson-1',
      scheduledAt: at('2026-11-16T07:00:00.000Z'),
      durationMin: 120,
      status: LessonStatus.SCHEDULED,
      cancelledAt: null,
      cancellationReason: null,
      updatedAt: NOW,
      instructor: instructorPerson,
      student: { id: 'student-1', firstName: 'Ірина', lastName: 'Коваль' },
      car: carView,
      meetingPlace: null as string | null,
      confirmationStatus: BookingConfirmation.CONFIRMED as BookingConfirmation,
      confirmedAt: NOW,
      paymentStatus: PaymentStatus.PAID,
      ...overrides,
    };
  }

  /** Пн 09:00–13:00 і 14:00–18:00. */
  const workingHours = [
    { dayOfWeek: DayOfWeek.MONDAY, startMinute: 540, endMinute: 780 },
    { dayOfWeek: DayOfWeek.MONDAY, startMinute: 840, endMinute: 1080 },
  ];

  const prisma = {
    organization: { findUnique: jest.fn() },
    user: { findFirst: jest.fn(), findUnique: jest.fn() },
    car: { findFirst: jest.fn(), findUnique: jest.fn() },
    drivingLesson: { findMany: jest.fn(), create: jest.fn() },
    lesson: { findMany: jest.fn() },
    enrollment: { findMany: jest.fn() },
    instructorWorkingHours: { findMany: jest.fn() },
    instructorTimeOff: { findMany: jest.fn() },
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  };

  const payment = { resolveForLesson: jest.fn() };

  let service: PracticeLessonsService;
  let log: jest.SpyInstance;
  /** Заняття студента, що бачить пошук активного заняття. */
  let studentLessons: { id: string; scheduledAt: Date; durationMin: number }[];
  /** Заняття, що бачать пошук зайнятості й конфліктів (запити з OR). */
  let busyLessons: object[];

  function advisoryKeys(): unknown[] {
    return prisma.$executeRaw.mock.calls.map(
      ([, ...values]: [TemplateStringsArray, ...unknown[]]) => values[0],
    );
  }

  function expectNoDatabaseCalls() {
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.drivingLesson.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: NOW });
    studentLessons = [];
    busyLessons = [];
    prisma.organization.findUnique.mockResolvedValue(organization);
    prisma.user.findFirst.mockImplementation(
      ({ where }: { where: { role: UserRole } }) =>
        Promise.resolve(
          where.role === UserRole.STUDENT ? studentRow() : instructorPerson,
        ),
    );
    prisma.user.findUnique.mockResolvedValue({
      organizationId: 'org-1',
      role: UserRole.INSTRUCTOR,
      status: UserStatus.ACTIVE,
      deletedAt: null,
    });
    prisma.car.findFirst.mockResolvedValue(carView);
    prisma.car.findUnique.mockResolvedValue({
      organizationId: 'org-1',
      instructorId: 'instructor-1',
      category: LicenseCategory.B,
      transmission: Transmission.MANUAL,
      status: CarStatus.AVAILABLE,
    });
    prisma.drivingLesson.findMany.mockImplementation(
      ({ where }: { where: { OR?: unknown } }) =>
        Promise.resolve(where.OR ? busyLessons : studentLessons),
    );
    prisma.drivingLesson.create.mockImplementation(
      ({ data }: { data: object }) => Promise.resolve(lessonRow(data)),
    );
    prisma.lesson.findMany.mockResolvedValue([]);
    prisma.enrollment.findMany.mockResolvedValue([{ groupId: 'group-1' }]);
    prisma.instructorWorkingHours.findMany.mockResolvedValue(workingHours);
    prisma.instructorTimeOff.findMany.mockResolvedValue([]);
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    payment.resolveForLesson.mockResolvedValue(PaymentStatus.PAID);
    service = new PracticeLessonsService(
      prisma as unknown as PrismaService,
      payment,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    log.mockRestore();
  });

  describe('list', () => {
    const range = {
      from: '2026-11-16T00:00:00+02:00',
      to: '2026-11-23T00:00:00+02:00',
    };

    it('returns lessons of the school in the window, without cancelled ones by default', async () => {
      prisma.drivingLesson.findMany.mockResolvedValue([lessonRow()]);

      const result = await service.list(admin, range);

      const window = {
        start: at('2026-11-15T22:00:00.000Z'),
        end: at('2026-11-22T22:00:00.000Z'),
      };
      expect(prisma.drivingLesson.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              { organizationId: 'org-1' },
              { scheduledAt: candidateWindow(window) },
              { status: { not: LessonStatus.CANCELLED } },
            ],
          },
          orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        }),
      );
      expect(result).toMatchObject({
        from: window.start,
        to: window.end,
        timezone: 'Europe/Kyiv',
      });
      expect(result.items).toEqual([
        expect.objectContaining({
          id: 'lesson-1',
          type: 'PRACTICE',
          endsAt: at('2026-11-16T09:00:00.000Z'),
          student: { id: 'student-1', firstName: 'Ірина', lastName: 'Коваль' },
        }),
      ]);
    });

    it('filters by instructor and student and can include cancelled lessons', async () => {
      prisma.drivingLesson.findMany.mockResolvedValue([]);

      await service.list(admin, {
        ...range,
        instructorId: 'instructor-1',
        studentId: 'student-1',
        includeCancelled: true,
      });

      const [{ where }] = prisma.drivingLesson.findMany.mock.calls[0] as [
        { where: { AND: object[] } },
      ];
      expect(where.AND).toEqual([
        { organizationId: 'org-1' },
        expect.objectContaining({ scheduledAt: expect.any(Object) }),
        { instructorId: 'instructor-1' },
        { studentId: 'student-1' },
      ]);
    });

    it('drops a candidate that ended before the window', async () => {
      prisma.drivingLesson.findMany.mockResolvedValue([
        lessonRow({ scheduledAt: at('2026-11-15T19:00:00.000Z') }),
        lessonRow({
          id: 'lesson-2',
          scheduledAt: at('2026-11-15T21:00:00.000Z'),
        }),
      ]);

      const result = await service.list(admin, range);

      expect(result.items.map((item) => item.id)).toEqual(['lesson-2']);
    });

    it('shows an instructor only their own lessons', async () => {
      prisma.drivingLesson.findMany.mockResolvedValue([]);

      await service.list(actor(UserRole.INSTRUCTOR, 'instructor-1'), {
        ...range,
        confirmationStatus: BookingConfirmation.PENDING,
      });

      const [{ where }] = prisma.drivingLesson.findMany.mock.calls[0] as [
        { where: { AND: object[] } },
      ];
      expect(where.AND).toEqual([
        { organizationId: 'org-1' },
        expect.objectContaining({ scheduledAt: expect.any(Object) }),
        { status: { not: LessonStatus.CANCELLED } },
        { instructorId: 'instructor-1' },
        { confirmationStatus: BookingConfirmation.PENDING },
      ]);
    });

    it('forbids an instructor asking for another instructor before the database', async () => {
      const error = await caught(
        service.list(actor(UserRole.INSTRUCTOR, 'instructor-1'), {
          ...range,
          instructorId: 'instructor-2',
        }),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expectNoDatabaseCalls();
    });

    it.each([UserRole.STUDENT, UserRole.TEACHER, UserRole.OWNER])(
      'forbids %s before the database',
      async (role) => {
        const error = await caught(service.list(actor(role), range));

        expect(error).toBeInstanceOf(ForbiddenException);
        expectNoDatabaseCalls();
      },
    );
  });

  describe('listAvailable', () => {
    const monday = {
      from: '2026-11-16T00:00:00+02:00',
      to: '2026-11-17T00:00:00+02:00',
    };

    it('returns the computed free slots of the student instructor and car', async () => {
      const result = await service.listAvailable(student, monday);

      expect(result).toMatchObject({
        from: at('2026-11-15T22:00:00.000Z'),
        to: at('2026-11-16T22:00:00.000Z'),
        timezone: 'Europe/Kyiv',
        durationMin: 120,
        activeLesson: null,
      });
      expect(
        result.items.map((item) => item.scheduledAt.toISOString()),
      ).toEqual([
        '2026-11-16T07:00:00.000Z',
        '2026-11-16T09:00:00.000Z',
        '2026-11-16T12:00:00.000Z',
        '2026-11-16T14:00:00.000Z',
      ]);
      expect(result.items[0]).toEqual({
        scheduledAt: at('2026-11-16T07:00:00.000Z'),
        endsAt: at('2026-11-16T09:00:00.000Z'),
        durationMin: 120,
        instructor: instructorPerson,
        car: carView,
      });
    });

    it('reads time off and lessons up to one lesson past the window end', async () => {
      await service.listAvailable(student, monday);

      const spanEnd = new Date(
        at('2026-11-16T22:00:00.000Z').getTime() + 120 * MINUTE_MS,
      );
      expect(prisma.instructorTimeOff.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          instructorId: 'instructor-1',
          startsAt: { lt: spanEnd },
          endsAt: { gt: at('2026-11-15T22:00:00.000Z') },
        },
        select: { startsAt: true, endsAt: true },
      });
      const blockerQuery = prisma.drivingLesson.findMany.mock.calls.find(
        ([args]: [{ where: { OR?: unknown } }]) => args.where.OR,
      ) as [{ where: { OR: unknown; scheduledAt: unknown } }];
      expect(blockerQuery[0].where.OR).toEqual([
        { instructorId: 'instructor-1' },
        { carId: { in: ['car-1'] } },
        { studentId: 'student-1' },
      ]);
      expect(blockerQuery[0].where.scheduledAt).toEqual(
        candidateWindow({
          start: at('2026-11-15T22:00:00.000Z'),
          end: spanEnd,
        }),
      );
    });

    it('hides slots taken by time off and by other lessons', async () => {
      prisma.instructorTimeOff.findMany.mockResolvedValue([
        {
          startsAt: at('2026-11-16T14:00:00.000Z'),
          endsAt: at('2026-11-16T16:00:00.000Z'),
        },
      ]);
      busyLessons = [
        {
          instructorId: 'instructor-1',
          carId: 'car-1',
          studentId: 'student-2',
          scheduledAt: at('2026-11-16T09:00:00.000Z'),
          durationMin: 120,
        },
      ];

      const result = await service.listAvailable(student, monday);

      expect(
        result.items.map((item) => item.scheduledAt.toISOString()),
      ).toEqual(['2026-11-16T07:00:00.000Z', '2026-11-16T12:00:00.000Z']);
    });

    it('reports an upcoming lesson of the student and still lists the slots', async () => {
      studentLessons = [
        {
          id: 'lesson-9',
          scheduledAt: at('2026-11-12T08:00:00.000Z'),
          durationMin: 120,
        },
      ];

      const result = await service.listAvailable(student, monday);

      expect(result.activeLesson).toEqual({
        id: 'lesson-9',
        scheduledAt: at('2026-11-12T08:00:00.000Z'),
        endsAt: at('2026-11-12T10:00:00.000Z'),
      });
      expect(result.items).toHaveLength(4);
    });

    it('does not count a SCHEDULED lesson that has already ended', async () => {
      studentLessons = [
        {
          id: 'past',
          scheduledAt: at('2026-11-10T07:00:00.000Z'),
          durationMin: 120,
        },
      ];

      const result = await service.listAvailable(student, monday);

      expect(result.activeLesson).toBeNull();
      const [{ where }] = prisma.drivingLesson.findMany.mock.calls[0] as [
        { where: object },
      ];
      expect(where).toEqual({
        organizationId: 'org-1',
        studentId: 'student-1',
        status: LessonStatus.SCHEDULED,
        scheduledAt: { gt: new Date(NOW.getTime() - 240 * MINUTE_MS) },
      });
    });

    it('returns an empty list when the instructor or the car cannot be booked', async () => {
      prisma.car.findFirst.mockResolvedValue(null);

      const result = await service.listAvailable(student, monday);

      expect(result.items).toEqual([]);
      expect(prisma.instructorWorkingHours.findMany).not.toHaveBeenCalled();
      expect(prisma.car.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'car-1',
            organizationId: 'org-1',
            instructorId: 'instructor-1',
            status: CarStatus.AVAILABLE,
            category: LicenseCategory.B,
            transmission: Transmission.MANUAL,
          },
        }),
      );
    });

    it('answers 409 when the practice profile has no car', async () => {
      prisma.user.findFirst.mockResolvedValue(studentRow({ carId: null }));

      const error = await caught(service.listAvailable(student, monday));

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(PRACTICE_PROFILE_INCOMPLETE_MESSAGE);
    });

    it('answers 403 with the no-access message for a student without practice access', async () => {
      prisma.user.findFirst.mockResolvedValue(
        studentRow({ trainingStatus: TrainingStatus.ACTIVE }),
      );

      const error = await caught(service.listAvailable(student, monday));

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.message).toBe(NO_PRACTICE_ACCESS_MESSAGE);
      expect(prisma.instructorWorkingHours.findMany).not.toHaveBeenCalled();
    });

    it('answers 409 for a blocked student who still has practice access', async () => {
      prisma.user.findFirst.mockResolvedValue({
        ...studentRow(),
        status: UserStatus.BLOCKED,
      });

      const error = await caught(service.listAvailable(student, monday));

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(STUDENT_NOT_IN_PRACTICE_MESSAGE);
    });

    it('hides slots that start less than 3 hours from now', async () => {
      // Понеділок 08:00 за Києвом: найраніший слот — 11:00.
      jest.setSystemTime(at('2026-11-16T06:00:00.000Z'));

      const result = await service.listAvailable(student, monday);

      expect(
        result.items.map((item) => item.scheduledAt.toISOString()),
      ).toEqual([
        '2026-11-16T09:00:00.000Z',
        '2026-11-16T12:00:00.000Z',
        '2026-11-16T14:00:00.000Z',
      ]);
    });

    it('answers 404 without a student profile', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const error = await caught(service.listAvailable(student, monday));

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(STUDENT_NOT_FOUND_MESSAGE);
    });

    it('rejects a reversed window before the database', async () => {
      const error = await caught(
        service.listAvailable(student, { from: monday.to, to: monday.from }),
      );

      expect(error.getResponse()).toEqual(
        fieldErrors('to', SCHEDULE_RANGE_ORDER_MESSAGE),
      );
      expectNoDatabaseCalls();
    });

    it.each([UserRole.ADMIN, UserRole.INSTRUCTOR, UserRole.OWNER])(
      'forbids %s before the database',
      async (role) => {
        const error = await caught(service.listAvailable(actor(role), monday));

        expect(error).toBeInstanceOf(ForbiddenException);
        expectNoDatabaseCalls();
      },
    );
  });

  describe('book', () => {
    const request = { scheduledAt: '2026-11-16T09:00:00+02:00' };

    it('creates a 120-minute lesson with the student instructor and car under the practice keys', async () => {
      const result = await service.book(student, request);

      expect(advisoryKeys()).toEqual([
        'car:car-1',
        'group:group-1',
        'instructor:instructor-1',
        'student:student-1',
      ]);
      expect(prisma.drivingLesson.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            organizationId: 'org-1',
            instructorId: 'instructor-1',
            studentId: 'student-1',
            carId: 'car-1',
            scheduledAt: at('2026-11-16T07:00:00.000Z'),
            durationMin: 120,
            meetingPlace: null,
            confirmationStatus: BookingConfirmation.PENDING,
            paymentStatus: PaymentStatus.PAID,
          },
        }),
      );
      expect(payment.resolveForLesson).toHaveBeenCalledWith(prisma, {
        organizationId: 'org-1',
        studentId: 'student-1',
      });
      expect(result).toMatchObject({
        type: 'PRACTICE',
        status: LessonStatus.SCHEDULED,
        bookingStatus: 'PENDING',
        confirmationStatus: BookingConfirmation.PENDING,
        paymentStatus: PaymentStatus.PAID,
        endsAt: at('2026-11-16T09:00:00.000Z'),
      });
      expect(log).toHaveBeenCalledWith(
        'Practice lesson booked lessonId=lesson-1 studentId=student-1 instructorId=instructor-1 carId=car-1 scheduledAt=2026-11-16T07:00:00.000Z durationMin=120 organizationId=org-1',
      );
    });

    it('stores the meeting place when the student gives one', async () => {
      await service.book(student, { ...request, meetingPlace: 'Біля метро' });

      const [{ data }] = prisma.drivingLesson.create.mock.calls[0] as [
        { data: { meetingPlace: string } },
      ];
      expect(data.meetingPlace).toBe('Біля метро');
    });

    it('refuses a second lesson while one is still ahead and creates nothing', async () => {
      studentLessons = [
        {
          id: 'lesson-9',
          scheduledAt: at('2026-11-12T08:00:00.000Z'),
          durationMin: 120,
        },
      ];

      const error = await caught(service.book(student, request));

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(STUDENT_HAS_ACTIVE_LESSON_MESSAGE);
      expect(prisma.drivingLesson.create).not.toHaveBeenCalled();
    });

    it('counts a lesson in progress as active', async () => {
      studentLessons = [
        {
          id: 'now',
          scheduledAt: at('2026-11-10T09:00:00.000Z'),
          durationMin: 120,
        },
      ];

      const error = await caught(service.book(student, request));

      expect(error.message).toBe(STUDENT_HAS_ACTIVE_LESSON_MESSAGE);
    });

    it.each([
      ['off the grid', '2026-11-16T10:00:00+02:00'],
      ['in the break', '2026-11-16T13:00:00+02:00'],
      ['on a day off', '2026-11-17T09:00:00+02:00'],
      [
        'where the last lesson would run past the shift',
        '2026-11-16T17:00:00+02:00',
      ],
    ])('refuses a time %s', async (_, scheduledAt) => {
      const error = await caught(service.book(student, { scheduledAt }));

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(SLOT_NOT_OPEN_MESSAGE);
      expect(prisma.drivingLesson.create).not.toHaveBeenCalled();
    });

    it('answers 409 with conflicts when the slot is taken or the instructor is off', async () => {
      prisma.instructorTimeOff.findMany.mockResolvedValue([
        {
          id: 'time-off-1',
          startsAt: at('2026-11-15T22:00:00.000Z'),
          endsAt: at('2026-11-16T22:00:00.000Z'),
        },
      ]);
      busyLessons = [
        {
          id: 'lesson-2',
          instructorId: 'instructor-1',
          carId: 'car-1',
          studentId: 'student-2',
          scheduledAt: at('2026-11-16T07:00:00.000Z'),
          durationMin: 120,
        },
      ];

      const error = await caught(service.book(student, request));

      expect(error).toBeInstanceOf(ConflictException);
      const body = error.getResponse() as {
        message: string;
        conflicts: { resource: string; lessonType: string }[];
      };
      expect(body.message).toBe(LESSON_SCHEDULE_CONFLICT_MESSAGE);
      expect(
        body.conflicts.map((c) => `${c.resource}/${c.lessonType}`),
      ).toEqual(['INSTRUCTOR/TIME_OFF', 'INSTRUCTOR/PRACTICE', 'CAR/PRACTICE']);
      expect(prisma.drivingLesson.create).not.toHaveBeenCalled();
    });

    it('refuses a blocked instructor', async () => {
      prisma.user.findUnique.mockResolvedValue({
        organizationId: 'org-1',
        role: UserRole.INSTRUCTOR,
        status: UserStatus.BLOCKED,
        deletedAt: null,
      });

      const error = await caught(service.book(student, request));

      expect(error.message).toBe(INSTRUCTOR_NOT_ACTIVE_MESSAGE);
      expect(prisma.drivingLesson.create).not.toHaveBeenCalled();
    });

    it('refuses a car in maintenance or of another school', async () => {
      prisma.car.findUnique.mockResolvedValueOnce({
        organizationId: 'org-1',
        instructorId: 'instructor-1',
        category: LicenseCategory.B,
        transmission: Transmission.MANUAL,
        status: CarStatus.MAINTENANCE,
      });
      const maintenance = await caught(service.book(student, request));
      prisma.car.findUnique.mockResolvedValueOnce(null);
      const missing = await caught(service.book(student, request));

      expect(maintenance.message).toBe(CAR_NOT_AVAILABLE_MESSAGE);
      expect(missing.message).toBe(CAR_NOT_FOUND_MESSAGE);
    });

    it('rejects a start that is not in the future before the database', async () => {
      const error = await caught(
        service.book(student, { scheduledAt: '2026-11-10T10:00:00Z' }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual(
        fieldErrors('scheduledAt', BOOKING_IN_PAST_MESSAGE),
      );
      expectNoDatabaseCalls();
    });

    it('refuses a start less than 3 hours ahead before the database', async () => {
      const error = await caught(
        service.book(student, { scheduledAt: '2026-11-10T12:59:00Z' }),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(BOOKING_TOO_SOON_MESSAGE);
      expectNoDatabaseCalls();
    });

    it('answers 403 when the student has no practice access, before locking', async () => {
      prisma.user.findFirst.mockResolvedValue(
        studentRow({ trainingStatus: TrainingStatus.ACTIVE }),
      );

      const error = await caught(service.book(student, request));

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.message).toBe(NO_PRACTICE_ACCESS_MESSAGE);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('answers 409 when the practice profile is incomplete, before locking', async () => {
      prisma.user.findFirst.mockResolvedValue(
        studentRow({ instructorId: null }),
      );

      const error = await caught(service.book(student, request));

      expect(error.message).toBe(PRACTICE_PROFILE_INCOMPLETE_MESSAGE);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each([
      UserRole.ADMIN,
      UserRole.INSTRUCTOR,
      UserRole.TEACHER,
      UserRole.OWNER,
    ])('forbids %s before the database', async (role) => {
      const error = await caught(service.book(actor(role), request));

      expect(error).toBeInstanceOf(ForbiddenException);
      expectNoDatabaseCalls();
    });
  });
});
