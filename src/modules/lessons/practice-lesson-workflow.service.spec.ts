import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingConfirmation,
  CarStatus,
  LessonStatus,
  LicenseCategory,
  PaymentStatus,
  Prisma,
  TrainingStatus,
  Transmission,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { INSTRUCTOR_NOT_ACTIVE_MESSAGE } from '../cars/cars.service';
import { CAR_NOT_AVAILABLE_MESSAGE } from '../students/students.service';
import {
  BOOKING_CONFIRMATION_EXPIRED_MESSAGE,
  BOOKING_NOT_PENDING_MESSAGE,
  BOOKING_REJECTED_DEFAULT_REASON,
  PRACTICE_CAR_MISSING_MESSAGE,
  PracticeLessonWorkflowService,
} from './practice-lesson-workflow.service';

async function caught(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('Expected the promise to reject');
}

const NOW = new Date('2026-11-10T10:00:00.000Z');
const HOUR_MS = 60 * 60_000;
const at = (iso: string) => new Date(iso);

function actor(role: UserRole, id = `${role.toLowerCase()}-1`): User {
  return { id, role, organizationId: 'org-1' } as User;
}

/** Рядок practiceLessonSelect: запит студента, що чекає підтвердження. */
function lessonRow(overrides: object = {}) {
  return {
    id: 'lesson-1',
    instructorId: 'instructor-1',
    studentId: 'student-1',
    carId: 'car-1' as string | null,
    scheduledAt: at('2026-11-16T07:00:00.000Z'),
    durationMin: 120,
    status: LessonStatus.SCHEDULED as LessonStatus,
    cancelledAt: null as Date | null,
    cancellationReason: null as string | null,
    updatedAt: NOW,
    meetingPlace: null as string | null,
    confirmationStatus: BookingConfirmation.PENDING as BookingConfirmation,
    confirmedAt: null as Date | null,
    paymentStatus: PaymentStatus.PAID,
    instructor: {
      id: 'instructor-1',
      firstName: 'Олег',
      lastName: 'Ткаченко',
      role: UserRole.INSTRUCTOR,
      status: UserStatus.ACTIVE,
      deletedAt: null,
    },
    student: {
      id: 'student-1',
      firstName: 'Ірина',
      lastName: 'Коваль',
      status: UserStatus.ACTIVE,
      deletedAt: null,
      studentProfile: {
        trainingStatus: TrainingStatus.PRACTICE,
        category: LicenseCategory.B,
        transmission: Transmission.MANUAL,
        instructorId: 'instructor-1',
        carId: 'car-1',
      },
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

describe('PracticeLessonWorkflowService', () => {
  const admin = actor(UserRole.ADMIN);
  const instructor = actor(UserRole.INSTRUCTOR);

  const prisma = {
    organization: { findUnique: jest.fn() },
    drivingLesson: { findFirst: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn() },
    car: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };

  let service: PracticeLessonWorkflowService;
  let log: jest.SpyInstance;

  function given(row: ReturnType<typeof lessonRow>) {
    prisma.drivingLesson.findFirst.mockResolvedValue(row);
    prisma.drivingLesson.update.mockImplementation(
      ({ data }: { data: object }) => Promise.resolve({ ...row, ...data }),
    );
  }

  function updateData(): unknown {
    expect(prisma.drivingLesson.update).toHaveBeenCalledTimes(1);
    return (prisma.drivingLesson.update.mock.calls[0] as [{ data: unknown }])[0]
      .data;
  }

  function expectNoDatabaseCalls() {
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: NOW });
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      deletedAt: null,
    });
    prisma.user.findUnique.mockResolvedValue({
      organizationId: 'org-1',
      role: UserRole.INSTRUCTOR,
      status: UserStatus.ACTIVE,
      deletedAt: null,
    });
    prisma.car.findUnique.mockResolvedValue({
      organizationId: 'org-1',
      instructorId: 'instructor-1',
      category: LicenseCategory.B,
      transmission: Transmission.MANUAL,
      status: CarStatus.AVAILABLE,
    });
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    given(lessonRow());
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    service = new PracticeLessonWorkflowService(
      prisma as unknown as PrismaService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    log.mockRestore();
  });

  describe('confirm', () => {
    it('confirms a pending request, records who and when, and locks the row first', async () => {
      const result = await service.confirm(admin, 'lesson-1');

      const [strings, ...values] = prisma.$queryRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ];
      expect(Prisma.sql(strings, ...values).text).toContain('FOR UPDATE');
      expect(updateData()).toEqual({
        confirmationStatus: BookingConfirmation.CONFIRMED,
        confirmedAt: NOW,
        confirmedById: 'admin-1',
      });
      expect(result).toMatchObject({
        bookingStatus: 'CONFIRMED',
        status: LessonStatus.SCHEDULED,
        confirmedAt: NOW,
      });
      expect(log).toHaveBeenCalledWith(
        'Practice booking confirmed lessonId=lesson-1 scheduledAt=2026-11-16T07:00:00.000Z actorId=admin-1 organizationId=org-1',
      );
    });

    it('lets the instructor of the lesson confirm it', async () => {
      await service.confirm(instructor, 'lesson-1');

      expect(updateData()).toMatchObject({ confirmedById: 'instructor-1' });
    });

    it('forbids another instructor', async () => {
      const error = await caught(
        service.confirm(actor(UserRole.INSTRUCTOR, 'instructor-2'), 'lesson-1'),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(prisma.drivingLesson.update).not.toHaveBeenCalled();
    });

    it.each([UserRole.STUDENT, UserRole.TEACHER, UserRole.OWNER])(
      'forbids %s before the database',
      async (role) => {
        const error = await caught(service.confirm(actor(role), 'lesson-1'));

        expect(error).toBeInstanceOf(ForbiddenException);
        expectNoDatabaseCalls();
      },
    );

    it('answers 404 for a lesson of another school', async () => {
      prisma.drivingLesson.findFirst.mockResolvedValue(null);

      const error = await caught(service.confirm(admin, 'lesson-1'));

      expect(error).toBeInstanceOf(NotFoundException);
    });

    it.each([
      [
        'already confirmed',
        { confirmationStatus: BookingConfirmation.CONFIRMED, confirmedAt: NOW },
        'CONFIRMED',
      ],
      [
        'rejected',
        {
          status: LessonStatus.CANCELLED,
          confirmationStatus: BookingConfirmation.REJECTED,
          cancelledAt: NOW,
        },
        'REJECTED',
      ],
      [
        'withdrawn by the student',
        { status: LessonStatus.CANCELLED, cancelledAt: NOW },
        'CANCELLED',
      ],
    ])(
      'answers 409 with the current status when the request is %s',
      async (_, overrides, currentStatus) => {
        given(lessonRow(overrides));

        const error = await caught(service.confirm(admin, 'lesson-1'));

        expect(error).toBeInstanceOf(ConflictException);
        expect(error.getResponse()).toEqual({
          statusCode: 409,
          error: 'Conflict',
          message: BOOKING_NOT_PENDING_MESSAGE,
          currentStatus,
        });
        expect(prisma.drivingLesson.update).not.toHaveBeenCalled();
      },
    );

    it('refuses a request less than 2 hours before the start', async () => {
      given(
        lessonRow({ scheduledAt: new Date(NOW.getTime() + 2 * HOUR_MS - 1) }),
      );

      const error = await caught(service.confirm(admin, 'lesson-1'));

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(BOOKING_CONFIRMATION_EXPIRED_MESSAGE);
    });

    it('still confirms exactly 2 hours before the start', async () => {
      given(lessonRow({ scheduledAt: new Date(NOW.getTime() + 2 * HOUR_MS) }));

      await service.confirm(admin, 'lesson-1');

      expect(prisma.drivingLesson.update).toHaveBeenCalledTimes(1);
    });

    it('refuses when the instructor was blocked after the booking', async () => {
      prisma.user.findUnique.mockResolvedValue({
        organizationId: 'org-1',
        role: UserRole.INSTRUCTOR,
        status: UserStatus.BLOCKED,
        deletedAt: null,
      });

      const error = await caught(service.confirm(admin, 'lesson-1'));

      expect(error.message).toBe(INSTRUCTOR_NOT_ACTIVE_MESSAGE);
      expect(prisma.drivingLesson.update).not.toHaveBeenCalled();
    });

    it('refuses when the car went to maintenance after the booking', async () => {
      prisma.car.findUnique.mockResolvedValue({
        organizationId: 'org-1',
        instructorId: 'instructor-1',
        category: LicenseCategory.B,
        transmission: Transmission.MANUAL,
        status: CarStatus.MAINTENANCE,
      });

      const error = await caught(service.confirm(admin, 'lesson-1'));

      expect(error.message).toBe(CAR_NOT_AVAILABLE_MESSAGE);
    });

    it('refuses a lesson without a car', async () => {
      given(lessonRow({ carId: null, car: null }));

      const error = await caught(service.confirm(admin, 'lesson-1'));

      expect(error.message).toBe(PRACTICE_CAR_MISSING_MESSAGE);
    });
  });

  describe('reject', () => {
    it('cancels the request as REJECTED with the default reason', async () => {
      const result = await service.reject(instructor, 'lesson-1', {});

      expect(updateData()).toEqual({
        status: LessonStatus.CANCELLED,
        confirmationStatus: BookingConfirmation.REJECTED,
        cancelledAt: NOW,
        cancelledById: 'instructor-1',
        cancellationReason: BOOKING_REJECTED_DEFAULT_REASON,
      });
      expect(result.bookingStatus).toBe('REJECTED');
      expect(log).toHaveBeenCalledWith(
        'Practice booking rejected lessonId=lesson-1 scheduledAt=2026-11-16T07:00:00.000Z actorId=instructor-1 organizationId=org-1',
      );
    });

    it('keeps the given reason', async () => {
      await service.reject(admin, 'lesson-1', {
        reason: 'Інструктор у відпустці',
      });

      expect(updateData()).toMatchObject({
        cancellationReason: 'Інструктор у відпустці',
      });
    });

    it('rejects even after the confirmation deadline', async () => {
      given(lessonRow({ scheduledAt: new Date(NOW.getTime() + HOUR_MS) }));

      await service.reject(admin, 'lesson-1', {});

      expect(prisma.drivingLesson.update).toHaveBeenCalledTimes(1);
    });

    it('answers 409 when the request is no longer pending', async () => {
      given(
        lessonRow({
          confirmationStatus: BookingConfirmation.CONFIRMED,
          confirmedAt: NOW,
        }),
      );

      const error = await caught(service.reject(admin, 'lesson-1', {}));

      expect(error).toBeInstanceOf(ConflictException);
      expect(prisma.drivingLesson.update).not.toHaveBeenCalled();
    });

    it('forbids a student before the database', async () => {
      const error = await caught(
        service.reject(actor(UserRole.STUDENT), 'lesson-1', {}),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expectNoDatabaseCalls();
    });
  });
});
