import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import {
  DrivingLessonStatus,
  EnrollmentStatus,
  LessonStatus,
  LicenseCategory,
  Transmission,
  User,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PracticeLessonView, TheoryLessonView } from './lesson-view';
import {
  PersonalScheduleItemDto,
  SCHEDULE_RANGE_LENGTH_MESSAGE,
  SCHEDULE_RANGE_ORDER_MESSAGE,
} from './lessons.dto';
import {
  lessonTiming,
  PersonalScheduleService,
} from './personal-schedule.service';

async function caught(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('Expected the promise to reject');
}

const NOW = new Date('2026-10-21T10:00:00.000Z');
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function minutesFromNow(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * MINUTE_MS);
}

function actor(role: UserRole, id: string): User {
  return { id, role, organizationId: 'org-1' } as User;
}

const teacher = actor(UserRole.TEACHER, 'teacher-1');
const instructor = actor(UserRole.INSTRUCTOR, 'instructor-1');
const student = actor(UserRole.STUDENT, 'student-1');

function theoryRow(
  overrides: Partial<TheoryLessonView> = {},
): TheoryLessonView {
  return {
    id: 'theory-1',
    topic: 'Дорожні знаки',
    scheduledAt: minutesFromNow(60),
    durationMin: 90,
    status: LessonStatus.SCHEDULED,
    cancelledAt: null,
    cancellationReason: null,
    updatedAt: NOW,
    group: {
      id: 'group-1',
      name: 'ПДР — Група А',
      teacher: { id: 'teacher-1', firstName: 'Ірина', lastName: 'Мельник' },
    },
    ...overrides,
  };
}

function practiceRow(
  overrides: Partial<PracticeLessonView> = {},
): PracticeLessonView {
  return {
    id: 'practice-1',
    scheduledAt: minutesFromNow(60),
    durationMin: 60,
    status: DrivingLessonStatus.SCHEDULED,
    cancelledAt: null,
    cancellationReason: null,
    updatedAt: NOW,
    instructor: { id: 'instructor-1', firstName: 'Олег', lastName: 'Коваль' },
    student: { id: 'student-1', firstName: 'Марія', lastName: 'Шевченко' },
    car: {
      id: 'car-1',
      plateNumber: 'AA1234BB',
      category: LicenseCategory.B,
      transmission: Transmission.MANUAL,
    },
    ...overrides,
  };
}

describe('PersonalScheduleService', () => {
  const prisma = {
    organization: { findUnique: jest.fn() },
    lesson: { findMany: jest.fn() },
    drivingLesson: { findMany: jest.fn() },
  };

  let service: PersonalScheduleService;

  /** AND-умови запиту: [scope ролі, вікно scheduledAt, фільтр статусу]. */
  function conditionsOf(mock: jest.Mock): unknown[] {
    expect(mock).toHaveBeenCalledTimes(1);
    return (mock.mock.calls[0] as [{ where: { AND: unknown[] } }])[0].where.AND;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: NOW });
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      timezone: 'Europe/Kyiv',
      deletedAt: null,
    });
    prisma.lesson.findMany.mockResolvedValue([]);
    prisma.drivingLesson.findMany.mockResolvedValue([]);
    service = new PersonalScheduleService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('roles and scope', () => {
    it.each([UserRole.ADMIN, UserRole.OWNER])(
      'refuses %s before touching the database',
      async (role) => {
        const error = await caught(
          service.getMySchedule(actor(role, 'someone'), {}),
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(prisma.organization.findUnique).not.toHaveBeenCalled();
        expect(prisma.lesson.findMany).not.toHaveBeenCalled();
        expect(prisma.drivingLesson.findMany).not.toHaveBeenCalled();
      },
    );

    it('gives TEACHER the theory of own groups of the own school only', async () => {
      await service.getMySchedule(teacher, {});

      expect(conditionsOf(prisma.lesson.findMany)[0]).toEqual({
        group: { organizationId: 'org-1', teacherId: 'teacher-1' },
      });
      expect(prisma.drivingLesson.findMany).not.toHaveBeenCalled();
    });

    it('gives INSTRUCTOR own practice of the own school only', async () => {
      await service.getMySchedule(instructor, {});

      expect(conditionsOf(prisma.drivingLesson.findMany)[0]).toEqual({
        organizationId: 'org-1',
        instructorId: 'instructor-1',
      });
      expect(prisma.lesson.findMany).not.toHaveBeenCalled();
    });

    it('gives STUDENT the active group, the history of completed groups and own practice', async () => {
      await service.getMySchedule(student, {});

      const theoryScope = conditionsOf(prisma.lesson.findMany)[0];
      expect(theoryScope).toEqual({
        group: { organizationId: 'org-1' },
        OR: [
          {
            group: {
              enrollments: {
                some: {
                  studentId: 'student-1',
                  status: EnrollmentStatus.ACTIVE,
                },
              },
            },
          },
          {
            scheduledAt: { lte: NOW },
            group: {
              enrollments: {
                some: {
                  studentId: 'student-1',
                  status: EnrollmentStatus.COMPLETED,
                },
              },
            },
          },
        ],
      });
      expect(JSON.stringify(theoryScope)).not.toContain(
        EnrollmentStatus.DROPPED,
      );
      expect(conditionsOf(prisma.drivingLesson.findMany)[0]).toEqual({
        organizationId: 'org-1',
        studentId: 'student-1',
      });
    });
  });

  describe('filters', () => {
    it('hides cancelled lessons by default', async () => {
      await service.getMySchedule(student, {});

      expect(conditionsOf(prisma.lesson.findMany)[2]).toEqual({
        status: { not: LessonStatus.CANCELLED },
      });
      expect(conditionsOf(prisma.drivingLesson.findMany)[2]).toEqual({
        status: { not: DrivingLessonStatus.CANCELLED },
      });
    });

    it('drops the status filter with includeCancelled', async () => {
      await service.getMySchedule(student, { includeCancelled: true });

      expect(conditionsOf(prisma.lesson.findMany)[2]).toEqual({});
      expect(conditionsOf(prisma.drivingLesson.findMany)[2]).toEqual({});
    });

    it('queries only theory for type THEORY', async () => {
      await service.getMySchedule(student, { type: 'THEORY' });

      expect(prisma.lesson.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.drivingLesson.findMany).not.toHaveBeenCalled();
    });

    it('returns an empty schedule without queries when the role has no lessons of the type', async () => {
      const schedule = await service.getMySchedule(teacher, {
        type: 'PRACTICE',
      });

      expect(schedule.items).toEqual([]);
      expect(prisma.lesson.findMany).not.toHaveBeenCalled();
      expect(prisma.drivingLesson.findMany).not.toHaveBeenCalled();
    });
  });

  describe('window', () => {
    it('defaults to the next 30 days from now', async () => {
      const schedule = await service.getMySchedule(student, {});

      expect(schedule.from).toEqual(NOW);
      expect(schedule.to).toEqual(new Date(NOW.getTime() + 30 * DAY_MS));
    });

    it('counts the default end from the given start', async () => {
      const schedule = await service.getMySchedule(student, {
        from: '2026-09-01T00:00:00Z',
      });

      expect(schedule.to).toEqual(new Date('2026-10-01T00:00:00Z'));
    });

    it('asks the database for lessons starting up to 240 minutes before from', async () => {
      await service.getMySchedule(student, {
        from: '2026-11-02T00:00:00Z',
        to: '2026-11-09T00:00:00Z',
      });

      expect(conditionsOf(prisma.lesson.findMany)[1]).toEqual({
        scheduledAt: {
          gt: new Date('2026-11-01T20:00:00Z'),
          lt: new Date('2026-11-09T00:00:00Z'),
        },
      });
    });

    it.each([
      ['equal to from', '2026-11-02T00:00:00Z'],
      ['before from', '2026-11-01T00:00:00Z'],
    ])('rejects to %s before any query', async (_, to) => {
      const error = await caught(
        service.getMySchedule(student, { from: '2026-11-02T00:00:00Z', to }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'to', message: SCHEDULE_RANGE_ORDER_MESSAGE }],
      });
      expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    });

    it('accepts a window of exactly 62 days', async () => {
      await expect(
        service.getMySchedule(student, {
          from: '2026-11-01T00:00:00.000Z',
          to: '2027-01-02T00:00:00.000Z',
        }),
      ).resolves.toMatchObject({ items: [] });
    });

    it('rejects a window longer than 62 days', async () => {
      const error = await caught(
        service.getMySchedule(student, {
          from: '2026-11-01T00:00:00.000Z',
          to: '2027-01-02T00:00:00.001Z',
        }),
      );

      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'to', message: SCHEDULE_RANGE_LENGTH_MESSAGE }],
      });
      expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    });

    it('keeps only lessons that overlap [from, to)', async () => {
      prisma.lesson.findMany.mockResolvedValue([
        // Закінчилося рівно в from.
        theoryRow({ id: 'ended', scheduledAt: minutesFromNow(-90) }),
        // Почалося до from і ще триває.
        theoryRow({ id: 'running', scheduledAt: minutesFromNow(-30) }),
        // Починається рівно в to.
        theoryRow({ id: 'at-end', scheduledAt: minutesFromNow(24 * 60) }),
      ]);

      const schedule = await service.getMySchedule(student, {
        to: minutesFromNow(24 * 60).toISOString(),
      });

      expect(schedule.items.map((item) => item.id)).toEqual(['running']);
    });
  });

  describe('response', () => {
    it.each([
      ['UPCOMING', minutesFromNow(1), minutesFromNow(61)],
      ['IN_PROGRESS', NOW, minutesFromNow(60)],
      ['IN_PROGRESS', minutesFromNow(-30), minutesFromNow(30)],
      ['FINISHED', minutesFromNow(-60), NOW],
      ['FINISHED', minutesFromNow(-120), minutesFromNow(-60)],
    ])('marks a lesson %s', (expected, scheduledAt, endsAt) => {
      expect(lessonTiming(scheduledAt, endsAt, NOW)).toBe(expected);
    });

    it('maps rows to lesson DTOs with timing and nothing else', async () => {
      prisma.lesson.findMany.mockResolvedValue([theoryRow()]);
      prisma.drivingLesson.findMany.mockResolvedValue([
        practiceRow({ id: 'practice-1', scheduledAt: minutesFromNow(-30) }),
      ]);

      const { items } = await service.getMySchedule(student, {});

      const [practice, theory] = items;
      expect(theory).toEqual({
        id: 'theory-1',
        type: 'THEORY',
        status: LessonStatus.SCHEDULED,
        timing: 'UPCOMING',
        topic: 'Дорожні знаки',
        scheduledAt: minutesFromNow(60),
        endsAt: minutesFromNow(150),
        durationMin: 90,
        group: { id: 'group-1', name: 'ПДР — Група А' },
        teacher: { id: 'teacher-1', firstName: 'Ірина', lastName: 'Мельник' },
        cancelledAt: null,
        cancellationReason: null,
        updatedAt: NOW,
      });
      expect(practice).toEqual({
        id: 'practice-1',
        type: 'PRACTICE',
        status: DrivingLessonStatus.SCHEDULED,
        timing: 'IN_PROGRESS',
        scheduledAt: minutesFromNow(-30),
        endsAt: minutesFromNow(30),
        durationMin: 60,
        instructor: {
          id: 'instructor-1',
          firstName: 'Олег',
          lastName: 'Коваль',
        },
        student: { id: 'student-1', firstName: 'Марія', lastName: 'Шевченко' },
        car: {
          id: 'car-1',
          plateNumber: 'AA1234BB',
          category: LicenseCategory.B,
          transmission: Transmission.MANUAL,
        },
        cancelledAt: null,
        cancellationReason: null,
        updatedAt: NOW,
      });
    });

    it('sorts by time, then theory before practice, then id', async () => {
      const at = minutesFromNow(60);
      prisma.lesson.findMany.mockResolvedValue([
        theoryRow({ id: 'theory-b', scheduledAt: at }),
        theoryRow({ id: 'theory-late', scheduledAt: minutesFromNow(600) }),
        theoryRow({ id: 'theory-a', scheduledAt: at }),
      ]);
      prisma.drivingLesson.findMany.mockResolvedValue([
        practiceRow({ id: 'practice-early', scheduledAt: minutesFromNow(10) }),
        practiceRow({ id: 'practice-same', scheduledAt: at }),
      ]);

      const { items } = await service.getMySchedule(student, {});

      expect(items.map((item: PersonalScheduleItemDto) => item.id)).toEqual([
        'practice-early',
        'theory-a',
        'theory-b',
        'practice-same',
        'theory-late',
      ]);
    });

    it('returns the timezone of the school', async () => {
      await expect(service.getMySchedule(teacher, {})).resolves.toMatchObject({
        timezone: 'Europe/Kyiv',
      });
    });

    it.each([
      ['missing', null],
      [
        'soft-deleted',
        { id: 'org-1', timezone: 'Europe/Kyiv', deletedAt: NOW },
      ],
    ])('answers 404 when the school is %s', async (_, organization) => {
      prisma.organization.findUnique.mockResolvedValue(organization);

      const error = await caught(service.getMySchedule(teacher, {}));

      expect(error).toBeInstanceOf(NotFoundException);
      expect(prisma.lesson.findMany).not.toHaveBeenCalled();
    });
  });
});
