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
  DrivingLessonStatus,
  GroupStatus,
  LessonStatus,
  LicenseCategory,
  OrganizationStatus,
  Prisma,
  TrainingStatus,
  Transmission,
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
import { GROUP_NOT_FOUND_MESSAGE } from '../groups/groups.service';
import {
  CAR_NOT_AVAILABLE_MESSAGE,
  INSTRUCTOR_CAR_MISMATCH_MESSAGE,
  STUDENT_NOT_FOUND_MESSAGE,
} from '../students/students.service';
import {
  LESSON_ALREADY_STARTED_MESSAGE,
  LESSON_CANCEL_STARTED_MESSAGE,
  LESSON_CREATE_IN_PAST_MESSAGE,
  LESSON_GROUP_CLOSED_MESSAGE,
  LESSON_GROUP_NOT_OPEN_MESSAGE,
  LESSON_HAS_ATTENDANCE_MESSAGE,
  LESSON_IN_PAST_MESSAGE,
  LESSON_INSTRUCTOR_ASSIGN_MESSAGE,
  LESSON_INSTRUCTOR_CHANGE_MESSAGE,
  LESSON_NOT_CANCELLABLE_MESSAGE,
  LESSON_NOT_EDITABLE_MESSAGE,
  LESSON_NOT_FOUND_MESSAGE,
  LESSON_OUTSIDE_GROUP_DATES_MESSAGE,
  LESSON_TEACHER_NOT_ACTIVE_MESSAGE,
  LessonsService,
  NO_PRACTICE_LESSON_FIELDS_MESSAGE,
  NO_THEORY_LESSON_FIELDS_MESSAGE,
  PRACTICE_CAR_REQUIRED_MESSAGE,
  PRACTICE_INSTRUCTOR_REQUIRED_MESSAGE,
  STUDENT_NOT_ASSIGNED_MESSAGE,
  STUDENT_NOT_IN_PRACTICE_MESSAGE,
} from './lessons.service';
import { LESSON_SCHEDULE_CONFLICT_MESSAGE } from './schedule-conflicts';

async function caught(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('Expected the promise to reject');
}

const NOW = new Date('2026-10-21T10:00:00.000Z');

describe('LessonsService', () => {
  const admin = {
    id: 'admin-1',
    role: UserRole.ADMIN,
    organizationId: 'org-1',
  };
  const instructorActor = {
    id: 'instructor-1',
    role: UserRole.INSTRUCTOR,
    organizationId: 'org-1',
  };
  const teacherActor = {
    id: 'teacher-1',
    role: UserRole.TEACHER,
    organizationId: 'org-1',
  };
  const studentActor = {
    id: 'student-1',
    role: UserRole.STUDENT,
    organizationId: 'org-1',
  };
  const ownerActor = {
    id: 'owner-1',
    role: UserRole.OWNER,
    organizationId: 'org-1',
  };

  const organization = {
    id: 'org-1',
    status: OrganizationStatus.ACTIVE,
    timezone: 'Europe/Kyiv',
    deletedAt: null,
  };

  type PracticeRow = ReturnType<typeof practiceRow>;

  function practiceRow(
    overrides: {
      lesson?: object;
      instructor?: object;
      student?: object;
      profile?: object | null;
    } = {},
  ) {
    const profile =
      overrides.profile === null
        ? null
        : {
            trainingStatus: TrainingStatus.PRACTICE as TrainingStatus,
            category: LicenseCategory.B as LicenseCategory | null,
            transmission: Transmission.MANUAL as Transmission | null,
            carId: 'car-1' as string | null,
            ...overrides.profile,
          };
    return {
      id: 'lesson-1',
      instructorId: 'instructor-1',
      studentId: 'student-1',
      carId: 'car-1' as string | null,
      scheduledAt: new Date('2026-11-02T08:00:00.000Z'),
      durationMin: 60,
      status: DrivingLessonStatus.SCHEDULED as DrivingLessonStatus,
      cancelledAt: null as Date | null,
      cancellationReason: null as string | null,
      updatedAt: new Date('2026-10-20T09:00:00.000Z'),
      instructor: {
        id: 'instructor-1',
        firstName: 'Олег',
        lastName: 'Ткаченко',
        role: UserRole.INSTRUCTOR as UserRole,
        status: UserStatus.ACTIVE as UserStatus,
        deletedAt: null as Date | null,
        ...overrides.instructor,
      },
      student: {
        id: 'student-1',
        firstName: 'Марія',
        lastName: 'Коваль',
        status: UserStatus.ACTIVE as UserStatus,
        deletedAt: null as Date | null,
        studentProfile: profile,
        ...overrides.student,
      },
      car: {
        id: 'car-1',
        plateNumber: 'AA1234BB',
        category: LicenseCategory.B,
        transmission: Transmission.MANUAL,
      } as {
        id: string;
        plateNumber: string;
        category: LicenseCategory;
        transmission: Transmission;
      } | null,
      ...overrides.lesson,
    };
  }

  function theoryRow(
    overrides: { lesson?: object; group?: object; teacher?: object } = {},
  ) {
    return {
      id: 'lesson-t1',
      groupId: 'group-1',
      topic: 'Дорожні знаки',
      scheduledAt: new Date('2026-11-03T16:00:00.000Z'),
      durationMin: 90,
      status: LessonStatus.SCHEDULED as LessonStatus,
      cancelledAt: null as Date | null,
      cancellationReason: null as string | null,
      updatedAt: new Date('2026-10-20T09:00:00.000Z'),
      group: {
        id: 'group-1',
        name: 'ПДР — Група А',
        status: GroupStatus.ACTIVE as GroupStatus,
        teacherId: 'teacher-1',
        startDate: null as Date | null,
        endDate: null as Date | null,
        teacher: {
          id: 'teacher-1',
          firstName: 'Ірина',
          lastName: 'Мельник',
          status: UserStatus.ACTIVE as UserStatus,
          deletedAt: null as Date | null,
          ...overrides.teacher,
        },
        ...overrides.group,
      },
      ...overrides.lesson,
    };
  }

  const availableCar = {
    organizationId: 'org-1',
    instructorId: 'instructor-1',
    category: LicenseCategory.B,
    transmission: Transmission.MANUAL,
    status: CarStatus.AVAILABLE,
  };

  const activeInstructor = {
    organizationId: 'org-1',
    role: UserRole.INSTRUCTOR,
    status: UserStatus.ACTIVE,
    deletedAt: null,
  };

  const prisma = {
    organization: { findUnique: jest.fn() },
    group: { findFirst: jest.fn() },
    lesson: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    drivingLesson: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    enrollment: { findMany: jest.fn() },
    lessonAttendance: { count: jest.fn() },
    user: { findUnique: jest.fn(), findFirst: jest.fn() },
    car: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  };

  let service: LessonsService;
  let log: jest.SpyInstance;

  function givenPractice(row: PracticeRow) {
    prisma.drivingLesson.findFirst.mockResolvedValue(row);
    prisma.drivingLesson.update.mockImplementation(
      ({ data }: { data: object }) => Promise.resolve({ ...row, ...data }),
    );
  }

  function givenTheory(row: ReturnType<typeof theoryRow>) {
    prisma.lesson.findFirst.mockResolvedValue(row);
    prisma.lesson.update.mockImplementation(({ data }: { data: object }) =>
      Promise.resolve({ ...row, ...data }),
    );
  }

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

  function updateData(mock: jest.Mock): unknown {
    expect(mock).toHaveBeenCalledTimes(1);
    return (mock.mock.calls[0] as [{ data: unknown }])[0].data;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: NOW });
    prisma.organization.findUnique.mockResolvedValue(organization);
    prisma.lesson.findMany.mockResolvedValue([]);
    prisma.drivingLesson.findMany.mockResolvedValue([]);
    prisma.enrollment.findMany.mockResolvedValue([{ groupId: 'group-1' }]);
    prisma.lessonAttendance.count.mockResolvedValue(0);
    prisma.user.findUnique.mockResolvedValue(activeInstructor);
    prisma.car.findUnique.mockResolvedValue(availableCar);
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    givenPractice(practiceRow());
    givenTheory(theoryRow());
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    service = new LessonsService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    log.mockRestore();
    jest.useRealTimers();
  });

  describe('practice', () => {
    it('reschedules to a free slot and returns the saved lesson', async () => {
      const result = await service.reschedulePractice(
        admin as never,
        'lesson-1',
        { scheduledAt: '2026-11-03T10:00:00+02:00' },
      );

      expect(updateData(prisma.drivingLesson.update)).toEqual({
        scheduledAt: new Date('2026-11-03T08:00:00.000Z'),
      });
      expect(result).toEqual({
        id: 'lesson-1',
        type: 'PRACTICE',
        status: DrivingLessonStatus.SCHEDULED,
        scheduledAt: new Date('2026-11-03T08:00:00.000Z'),
        endsAt: new Date('2026-11-03T09:00:00.000Z'),
        durationMin: 60,
        instructor: {
          id: 'instructor-1',
          firstName: 'Олег',
          lastName: 'Ткаченко',
        },
        student: { id: 'student-1', firstName: 'Марія', lastName: 'Коваль' },
        car: {
          id: 'car-1',
          plateNumber: 'AA1234BB',
          category: LicenseCategory.B,
          transmission: Transmission.MANUAL,
        },
        cancelledAt: null,
        cancellationReason: null,
        updatedAt: new Date('2026-10-20T09:00:00.000Z'),
      });
    });

    it.each([
      ['TEACHER', teacherActor],
      ['STUDENT', studentActor],
      ['OWNER', ownerActor],
    ])('forbids %s without touching the database', async (_, actor) => {
      const error = await caught(
        service.reschedulePractice(actor as never, 'lesson-1', {
          scheduledAt: '2026-11-03T10:00:00+02:00',
        }),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(prisma.organization.findUnique).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('forbids an instructor from changing another instructor lesson', async () => {
      givenPractice(practiceRow({ lesson: { instructorId: 'instructor-2' } }));

      const error = await caught(
        service.reschedulePractice(instructorActor as never, 'lesson-1', {
          scheduledAt: '2026-11-03T10:00:00+02:00',
        }),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(prisma.drivingLesson.update).not.toHaveBeenCalled();
    });

    it('lets an instructor reschedule their own lesson', async () => {
      await service.reschedulePractice(instructorActor as never, 'lesson-1', {
        scheduledAt: '2026-11-03T10:00:00+02:00',
      });

      expect(prisma.drivingLesson.update).toHaveBeenCalledTimes(1);
    });

    it('forbids an instructor from changing instructorId before the transaction', async () => {
      const error = await caught(
        service.updatePractice(instructorActor as never, 'lesson-1', {
          instructorId: 'instructor-1',
        }),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.message).toBe(LESSON_INSTRUCTOR_CHANGE_MESSAGE);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an empty edit body without reading the lesson', async () => {
      const error = await caught(
        service.updatePractice(admin as never, 'lesson-1', {}),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'body', message: NO_PRACTICE_LESSON_FIELDS_MESSAGE }],
      });
      expect(prisma.drivingLesson.findFirst).not.toHaveBeenCalled();
    });

    it('returns 404 for a lesson of another organization', async () => {
      prisma.drivingLesson.findFirst.mockResolvedValue(null);

      const error = await caught(
        service.reschedulePractice(admin as never, 'lesson-1', {
          scheduledAt: '2026-11-03T10:00:00+02:00',
        }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(LESSON_NOT_FOUND_MESSAGE);
      expect(prisma.drivingLesson.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'lesson-1', organizationId: 'org-1' },
        }),
      );
    });

    it('returns 404 when the organization is soft-deleted', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        ...organization,
        deletedAt: new Date(),
      });

      const error = await caught(
        service.reschedulePractice(admin as never, 'lesson-1', {
          scheduledAt: '2026-11-03T10:00:00+02:00',
        }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each([DrivingLessonStatus.COMPLETED, DrivingLessonStatus.CANCELLED])(
      'refuses to change a %s lesson and reports its status',
      async (status) => {
        givenPractice(practiceRow({ lesson: { status } }));

        const error = await caught(
          service.reschedulePractice(admin as never, 'lesson-1', {
            scheduledAt: '2026-11-03T10:00:00+02:00',
          }),
        );

        expect(error).toBeInstanceOf(ConflictException);
        expect(error.getResponse()).toEqual({
          statusCode: 409,
          message: LESSON_NOT_EDITABLE_MESSAGE,
          error: 'Conflict',
          currentStatus: status,
        });
      },
    );

    it('rejects a reschedule into the past as a scheduledAt error', async () => {
      const error = await caught(
        service.reschedulePractice(admin as never, 'lesson-1', {
          scheduledAt: '2026-10-21T09:59:00Z',
        }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'scheduledAt', message: LESSON_IN_PAST_MESSAGE }],
      });
    });

    it('refuses to change the duration of a lesson that already started', async () => {
      givenPractice(
        practiceRow({
          lesson: { scheduledAt: new Date('2026-10-21T09:30:00.000Z') },
        }),
      );

      const error = await caught(
        service.updatePractice(admin as never, 'lesson-1', { durationMin: 90 }),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(LESSON_ALREADY_STARTED_MESSAGE);
    });

    it('moves a missed lesson to the future', async () => {
      givenPractice(
        practiceRow({
          lesson: { scheduledAt: new Date('2026-10-20T08:00:00.000Z') },
        }),
      );

      await service.reschedulePractice(admin as never, 'lesson-1', {
        scheduledAt: '2026-10-22T08:00:00Z',
      });

      expect(updateData(prisma.drivingLesson.update)).toEqual({
        scheduledAt: new Date('2026-10-22T08:00:00.000Z'),
      });
    });

    it.each([
      ['dropped', { profile: { trainingStatus: TrainingStatus.DROPPED } }],
      [
        'still ACTIVE without practice access',
        { profile: { trainingStatus: TrainingStatus.ACTIVE } },
      ],
      ['blocked', { student: { status: UserStatus.BLOCKED } }],
      ['deleted', { student: { deletedAt: new Date() } }],
      ['without a profile', { profile: null, lesson: { carId: 'car-1' } }],
    ])('refuses a student who is %s', async (_, overrides) => {
      givenPractice(practiceRow(overrides));

      const error = await caught(
        service.reschedulePractice(admin as never, 'lesson-1', {
          scheduledAt: '2026-11-03T10:00:00+02:00',
        }),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(STUDENT_NOT_IN_PRACTICE_MESSAGE);
    });

    it('refuses to reschedule with a blocked current instructor', async () => {
      givenPractice(
        practiceRow({ instructor: { status: UserStatus.BLOCKED } }),
      );

      const error = await caught(
        service.reschedulePractice(admin as never, 'lesson-1', {
          scheduledAt: '2026-11-03T10:00:00+02:00',
        }),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(INSTRUCTOR_NOT_ACTIVE_MESSAGE);
    });

    it.each([
      [
        'from another organization',
        { ...activeInstructor, organizationId: 'org-2' },
        NotFoundException,
        INSTRUCTOR_NOT_FOUND_MESSAGE,
      ],
      ['missing', null, NotFoundException, INSTRUCTOR_NOT_FOUND_MESSAGE],
      [
        'not an instructor',
        { ...activeInstructor, role: UserRole.TEACHER },
        ConflictException,
        INSTRUCTOR_ROLE_MESSAGE,
      ],
      [
        'not active',
        { ...activeInstructor, status: UserStatus.INVITED },
        ConflictException,
        INSTRUCTOR_NOT_ACTIVE_MESSAGE,
      ],
    ])(
      'checks a new instructor who is %s',
      async (_, instructor, type, message) => {
        prisma.user.findUnique.mockResolvedValue(instructor);

        const error = await caught(
          service.updatePractice(admin as never, 'lesson-1', {
            instructorId: 'instructor-2',
            carId: 'car-2',
          }),
        );

        expect(error).toBeInstanceOf(type);
        expect(error.message).toBe(message);
      },
    );

    it('assigns a new instructor together with their car', async () => {
      prisma.car.findUnique.mockResolvedValue({
        ...availableCar,
        instructorId: 'instructor-2',
      });

      await service.updatePractice(admin as never, 'lesson-1', {
        instructorId: 'instructor-2',
        carId: 'car-2',
      });

      expect(updateData(prisma.drivingLesson.update)).toEqual({
        instructorId: 'instructor-2',
        carId: 'car-2',
      });
    });

    it('rejects a new instructor whose car does not match', async () => {
      const error = await caught(
        service.updatePractice(admin as never, 'lesson-1', {
          instructorId: 'instructor-2',
        }),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(INSTRUCTOR_CAR_MISMATCH_MESSAGE);
    });

    it("falls back to the student's car for a lesson without one", async () => {
      givenPractice(practiceRow({ lesson: { carId: null, car: null } }));

      await service.updatePractice(admin as never, 'lesson-1', {
        durationMin: 90,
      });

      expect(prisma.car.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'car-1' } }),
      );
      expect(updateData(prisma.drivingLesson.update)).toEqual({
        durationMin: 90,
        carId: 'car-1',
      });
    });

    it('requires a car when neither the lesson nor the student has one', async () => {
      givenPractice(
        practiceRow({
          lesson: { carId: null, car: null },
          profile: { carId: null },
        }),
      );

      const error = await caught(
        service.updatePractice(admin as never, 'lesson-1', { durationMin: 90 }),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(PRACTICE_CAR_REQUIRED_MESSAGE);
    });

    it.each([
      [
        'in maintenance',
        { ...availableCar, status: CarStatus.MAINTENANCE },
        ConflictException,
        CAR_NOT_AVAILABLE_MESSAGE,
      ],
      [
        'of another instructor',
        { ...availableCar, instructorId: 'instructor-2' },
        ConflictException,
        INSTRUCTOR_CAR_MISMATCH_MESSAGE,
      ],
      [
        'of another category',
        { ...availableCar, category: LicenseCategory.C },
        ConflictException,
        INSTRUCTOR_CAR_MISMATCH_MESSAGE,
      ],
      [
        'of another transmission',
        { ...availableCar, transmission: Transmission.AUTOMATIC },
        ConflictException,
        INSTRUCTOR_CAR_MISMATCH_MESSAGE,
      ],
      [
        'from another organization',
        { ...availableCar, organizationId: 'org-2' },
        NotFoundException,
        CAR_NOT_FOUND_MESSAGE,
      ],
    ])('refuses a car %s', async (_, car, type, message) => {
      prisma.car.findUnique.mockResolvedValue(car);

      const error = await caught(
        service.updatePractice(admin as never, 'lesson-1', { carId: 'car-2' }),
      );

      expect(error).toBeInstanceOf(type);
      expect(error.message).toBe(message);
      expect(prisma.drivingLesson.update).not.toHaveBeenCalled();
    });

    it('refuses a conflicting slot and lists the conflicts', async () => {
      prisma.drivingLesson.findMany.mockResolvedValue([
        {
          id: 'lesson-2',
          instructorId: 'instructor-1',
          carId: 'car-9',
          studentId: 'student-2',
          scheduledAt: new Date('2026-11-03T08:30:00.000Z'),
          durationMin: 60,
        },
      ]);

      const error = await caught(
        service.reschedulePractice(admin as never, 'lesson-1', {
          scheduledAt: '2026-11-03T10:00:00+02:00',
        }),
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
            lessonId: 'lesson-2',
            scheduledAt: new Date('2026-11-03T08:30:00.000Z'),
            endsAt: new Date('2026-11-03T09:30:00.000Z'),
          },
        ],
      });
      expect(prisma.drivingLesson.update).not.toHaveBeenCalled();
    });

    it('locks the lesson, then the resources, then checks conflicts, then writes', async () => {
      await service.reschedulePractice(admin as never, 'lesson-1', {
        scheduledAt: '2026-11-03T10:00:00+02:00',
      });

      expect(rawSql(prisma.$queryRaw, 0)).toContain(
        'FROM driving_lessons WHERE id = $1::uuid AND organization_id = $2::uuid FOR UPDATE',
      );
      const order = [
        prisma.$queryRaw.mock.invocationCallOrder[0],
        prisma.$executeRaw.mock.invocationCallOrder[0],
        prisma.drivingLesson.findMany.mock.invocationCallOrder[0],
        prisma.drivingLesson.update.mock.invocationCallOrder[0],
      ];
      expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it("locks the instructor, car, student and the student's open groups", async () => {
      prisma.enrollment.findMany.mockResolvedValue([
        { groupId: 'group-1' },
        { groupId: 'group-2' },
      ]);

      await service.reschedulePractice(admin as never, 'lesson-1', {
        scheduledAt: '2026-11-03T10:00:00+02:00',
      });

      expect(advisoryKeys()).toEqual([
        'car:car-1',
        'group:group-1',
        'group:group-2',
        'instructor:instructor-1',
        'student:student-1',
      ]);
    });

    it('returns the lesson unchanged when nothing changes', async () => {
      const result = await service.reschedulePractice(
        admin as never,
        'lesson-1',
        { scheduledAt: '2026-11-02T08:00:00Z', durationMin: 60 },
      );

      expect(result.scheduledAt).toEqual(new Date('2026-11-02T08:00:00.000Z'));
      expect(prisma.drivingLesson.update).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(prisma.drivingLesson.findMany).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    });

    it('writes only the fields that changed', async () => {
      await service.reschedulePractice(admin as never, 'lesson-1', {
        scheduledAt: '2026-11-02T08:00:00Z',
        durationMin: 90,
      });

      expect(updateData(prisma.drivingLesson.update)).toEqual({
        durationMin: 90,
      });
    });

    it('logs ids and changed fields without personal data', async () => {
      await service.reschedulePractice(admin as never, 'lesson-1', {
        scheduledAt: '2026-11-03T10:00:00+02:00',
      });

      expect(log).toHaveBeenCalledWith(
        'Lesson updated type=PRACTICE lessonId=lesson-1 fields=scheduledAt ' +
          'scheduledAt=2026-11-03T08:00:00.000Z actorId=admin-1 organizationId=org-1',
      );
      const logged = log.mock.calls.flat().join(' ');
      expect(logged).not.toContain('Марія');
      expect(logged).not.toContain('Олег');
    });
  });

  describe('theory', () => {
    it('lets the group teacher change only the topic without schedule checks', async () => {
      const result = await service.updateTheory(
        teacherActor as never,
        'lesson-t1',
        { topic: 'Дорожні знаки: попереджувальні' },
      );

      expect(updateData(prisma.lesson.update)).toEqual({
        topic: 'Дорожні знаки: попереджувальні',
      });
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(prisma.lesson.findMany).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: 'lesson-t1',
        type: 'THEORY',
        status: LessonStatus.SCHEDULED,
        topic: 'Дорожні знаки: попереджувальні',
        scheduledAt: new Date('2026-11-03T16:00:00.000Z'),
        endsAt: new Date('2026-11-03T17:30:00.000Z'),
        durationMin: 90,
        group: { id: 'group-1', name: 'ПДР — Група А' },
        teacher: { id: 'teacher-1', firstName: 'Ірина', lastName: 'Мельник' },
        cancelledAt: null,
        cancellationReason: null,
        updatedAt: new Date('2026-10-20T09:00:00.000Z'),
      });
    });

    it('forbids a teacher of another group', async () => {
      givenTheory(theoryRow({ group: { teacherId: 'teacher-2' } }));

      const error = await caught(
        service.updateTheory(teacherActor as never, 'lesson-t1', {
          topic: 'Інша тема',
        }),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(prisma.lesson.update).not.toHaveBeenCalled();
    });

    it.each([
      ['INSTRUCTOR', instructorActor],
      ['STUDENT', studentActor],
    ])('forbids %s', async (_, actor) => {
      const error = await caught(
        service.rescheduleTheory(actor as never, 'lesson-t1', {
          scheduledAt: '2026-11-04T18:00:00+02:00',
        }),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an empty edit body', async () => {
      const error = await caught(
        service.updateTheory(admin as never, 'lesson-t1', {}),
      );

      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'body', message: NO_THEORY_LESSON_FIELDS_MESSAGE }],
      });
    });

    it('returns 404 for a lesson of another organization', async () => {
      prisma.lesson.findFirst.mockResolvedValue(null);

      const error = await caught(
        service.rescheduleTheory(admin as never, 'lesson-t1', {
          scheduledAt: '2026-11-04T18:00:00+02:00',
        }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(prisma.lesson.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'lesson-t1', group: { organizationId: 'org-1' } },
        }),
      );
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('locks the group, then the lesson, then the resources, then writes', async () => {
      await service.rescheduleTheory(admin as never, 'lesson-t1', {
        scheduledAt: '2026-11-04T18:00:00+02:00',
      });

      expect(rawSql(prisma.$queryRaw, 0)).toBe(
        'SELECT id FROM groups WHERE id = $1::uuid AND organization_id = $2::uuid FOR SHARE',
      );
      expect(rawSql(prisma.$queryRaw, 1)).toContain('FOR UPDATE OF l');
      expect(advisoryKeys()).toEqual(['group:group-1', 'teacher:teacher-1']);
      const order = [
        prisma.$queryRaw.mock.invocationCallOrder[0],
        prisma.$queryRaw.mock.invocationCallOrder[1],
        prisma.lesson.findFirst.mock.invocationCallOrder[1],
        prisma.$executeRaw.mock.invocationCallOrder[0],
        prisma.lesson.findMany.mock.invocationCallOrder[0],
        prisma.lesson.update.mock.invocationCallOrder[0],
      ];
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(updateData(prisma.lesson.update)).toEqual({
        scheduledAt: new Date('2026-11-04T16:00:00.000Z'),
      });
    });

    it.each([GroupStatus.COMPLETED, GroupStatus.ARCHIVED])(
      'refuses any change to a lesson of a %s group',
      async (status) => {
        givenTheory(theoryRow({ group: { status } }));

        const error = await caught(
          service.updateTheory(admin as never, 'lesson-t1', {
            topic: 'Інша тема',
          }),
        );

        expect(error).toBeInstanceOf(ConflictException);
        expect(error.message).toBe(LESSON_GROUP_CLOSED_MESSAGE);
      },
    );

    it('refuses a cancelled lesson', async () => {
      givenTheory(theoryRow({ lesson: { status: LessonStatus.CANCELLED } }));

      const error = await caught(
        service.updateTheory(admin as never, 'lesson-t1', { topic: 'Інша' }),
      );

      expect(error.getResponse()).toMatchObject({
        statusCode: 409,
        currentStatus: LessonStatus.CANCELLED,
      });
    });

    it('requires an active teacher to reschedule', async () => {
      givenTheory(theoryRow({ teacher: { status: UserStatus.BLOCKED } }));

      const error = await caught(
        service.rescheduleTheory(admin as never, 'lesson-t1', {
          scheduledAt: '2026-11-04T18:00:00+02:00',
        }),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(LESSON_TEACHER_NOT_ACTIVE_MESSAGE);
    });

    describe('with marked attendance', () => {
      beforeEach(() => {
        // Відмітки бувають лише в заняття, що вже почалося.
        givenTheory(
          theoryRow({
            lesson: { scheduledAt: new Date('2026-10-21T09:30:00.000Z') },
          }),
        );
        prisma.lessonAttendance.count.mockResolvedValue(3);
      });

      it('refuses to move the lesson to another time', async () => {
        const error = await caught(
          service.rescheduleTheory(admin as never, 'lesson-t1', {
            scheduledAt: '2026-11-04T18:00:00+02:00',
          }),
        );

        expect(error).toBeInstanceOf(ConflictException);
        expect(error.message).toBe(LESSON_HAS_ATTENDANCE_MESSAGE);
        expect(prisma.lessonAttendance.count).toHaveBeenCalledWith({
          where: { lessonId: 'lesson-t1' },
        });
        expect(prisma.$executeRaw).not.toHaveBeenCalled();
        expect(prisma.lesson.update).not.toHaveBeenCalled();
      });

      it('still allows a topic change without counting the marks', async () => {
        await service.updateTheory(admin as never, 'lesson-t1', {
          topic: 'Інша тема',
        });

        expect(prisma.lessonAttendance.count).not.toHaveBeenCalled();
        expect(updateData(prisma.lesson.update)).toEqual({
          topic: 'Інша тема',
        });
      });
    });

    it('reschedules a lesson without attendance after counting the marks', async () => {
      await service.rescheduleTheory(admin as never, 'lesson-t1', {
        scheduledAt: '2026-11-04T18:00:00+02:00',
      });

      expect(prisma.lessonAttendance.count).toHaveBeenCalledTimes(1);
      expect(prisma.lesson.update).toHaveBeenCalledTimes(1);
    });

    it('allows a topic change even when the teacher is blocked', async () => {
      givenTheory(theoryRow({ teacher: { status: UserStatus.BLOCKED } }));

      await service.updateTheory(admin as never, 'lesson-t1', {
        topic: 'Інша тема',
      });

      expect(prisma.lesson.update).toHaveBeenCalledTimes(1);
    });

    describe('group dates in the school timezone', () => {
      beforeEach(() => {
        givenTheory(
          theoryRow({
            group: {
              startDate: new Date('2026-11-01T00:00:00.000Z'),
              endDate: new Date('2026-11-30T00:00:00.000Z'),
            },
          }),
        );
      });

      it('rejects a lesson that starts on December 1 in Kyiv', async () => {
        const error = await caught(
          service.rescheduleTheory(admin as never, 'lesson-t1', {
            scheduledAt: '2026-11-30T22:30:00Z',
          }),
        );

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.getResponse()).toEqual({
          statusCode: 400,
          errors: [
            {
              field: 'scheduledAt',
              message: LESSON_OUTSIDE_GROUP_DATES_MESSAGE,
            },
          ],
        });
      });

      it('accepts a lesson that already is November 1 in Kyiv', async () => {
        await service.rescheduleTheory(admin as never, 'lesson-t1', {
          scheduledAt: '2026-10-31T22:30:00Z',
        });

        expect(prisma.lesson.update).toHaveBeenCalledTimes(1);
      });
    });

    it('refuses a slot taken by the same group and teacher, and by a student', async () => {
      prisma.lesson.findMany.mockResolvedValue([
        {
          id: 'lesson-t2',
          groupId: 'group-1',
          scheduledAt: new Date('2026-11-04T16:30:00.000Z'),
          durationMin: 90,
          group: { teacherId: 'teacher-1' },
        },
      ]);
      prisma.drivingLesson.findMany.mockResolvedValue([
        {
          id: 'practice-1',
          studentId: 'student-7',
          scheduledAt: new Date('2026-11-04T16:00:00.000Z'),
          durationMin: 60,
        },
      ]);

      const error = await caught(
        service.rescheduleTheory(admin as never, 'lesson-t1', {
          scheduledAt: '2026-11-04T18:00:00+02:00',
        }),
      );

      expect(error).toBeInstanceOf(ConflictException);
      const body = error.getResponse() as { conflicts: { resource: string }[] };
      expect(body.conflicts.map((c) => c.resource)).toEqual([
        'TEACHER',
        'GROUP',
        'STUDENT',
      ]);
      expect(prisma.lesson.update).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    describe('practice', () => {
      it('cancels a future lesson, keeps its people and car, and returns the saved status', async () => {
        const result = await service.cancelPractice(
          admin as never,
          'lesson-1',
          { reason: 'Авто на ремонті' },
        );

        expect(updateData(prisma.drivingLesson.update)).toEqual({
          status: DrivingLessonStatus.CANCELLED,
          cancelledAt: NOW,
          cancelledById: 'admin-1',
          cancellationReason: 'Авто на ремонті',
        });
        expect(result).toEqual({
          id: 'lesson-1',
          type: 'PRACTICE',
          status: DrivingLessonStatus.CANCELLED,
          scheduledAt: new Date('2026-11-02T08:00:00.000Z'),
          endsAt: new Date('2026-11-02T09:00:00.000Z'),
          durationMin: 60,
          instructor: {
            id: 'instructor-1',
            firstName: 'Олег',
            lastName: 'Ткаченко',
          },
          student: { id: 'student-1', firstName: 'Марія', lastName: 'Коваль' },
          car: {
            id: 'car-1',
            plateNumber: 'AA1234BB',
            category: LicenseCategory.B,
            transmission: Transmission.MANUAL,
          },
          cancelledAt: NOW,
          cancellationReason: 'Авто на ремонті',
          updatedAt: new Date('2026-10-20T09:00:00.000Z'),
        });
      });

      it('stores null when no reason is given', async () => {
        await service.cancelPractice(admin as never, 'lesson-1', {});

        expect(updateData(prisma.drivingLesson.update)).toMatchObject({
          cancellationReason: null,
        });
      });

      it('lets an instructor cancel their own lesson', async () => {
        await service.cancelPractice(instructorActor as never, 'lesson-1', {});

        expect(updateData(prisma.drivingLesson.update)).toMatchObject({
          cancelledById: 'instructor-1',
        });
      });

      it('forbids an instructor from cancelling another instructor lesson', async () => {
        givenPractice(
          practiceRow({ lesson: { instructorId: 'instructor-2' } }),
        );

        const error = await caught(
          service.cancelPractice(instructorActor as never, 'lesson-1', {}),
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(prisma.drivingLesson.update).not.toHaveBeenCalled();
      });

      it.each([
        ['TEACHER', teacherActor],
        ['STUDENT', studentActor],
        ['OWNER', ownerActor],
      ])('forbids %s without touching the database', async (_, actor) => {
        const error = await caught(
          service.cancelPractice(actor as never, 'lesson-1', {}),
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(prisma.organization.findUnique).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('returns 404 for a lesson of another organization', async () => {
        prisma.drivingLesson.findFirst.mockResolvedValue(null);

        const error = await caught(
          service.cancelPractice(admin as never, 'lesson-1', {}),
        );

        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.message).toBe(LESSON_NOT_FOUND_MESSAGE);
        expect(prisma.drivingLesson.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'lesson-1', organizationId: 'org-1' },
          }),
        );
        expect(rawSql(prisma.$queryRaw, 0)).toContain(
          'WHERE id = $1::uuid AND organization_id = $2::uuid FOR UPDATE',
        );
        expect(prisma.drivingLesson.update).not.toHaveBeenCalled();
      });

      it.each([DrivingLessonStatus.COMPLETED, DrivingLessonStatus.CANCELLED])(
        'refuses a %s lesson and reports its status',
        async (status) => {
          givenPractice(practiceRow({ lesson: { status } }));

          const error = await caught(
            service.cancelPractice(admin as never, 'lesson-1', {}),
          );

          expect(error).toBeInstanceOf(ConflictException);
          expect(error.getResponse()).toEqual({
            statusCode: 409,
            message: LESSON_NOT_CANCELLABLE_MESSAGE,
            error: 'Conflict',
            currentStatus: status,
          });
          expect(prisma.drivingLesson.update).not.toHaveBeenCalled();
        },
      );

      it('reports the status, not the time, for a past cancelled lesson', async () => {
        givenPractice(
          practiceRow({
            lesson: {
              status: DrivingLessonStatus.CANCELLED,
              scheduledAt: new Date('2026-10-20T08:00:00.000Z'),
            },
          }),
        );

        const error = await caught(
          service.cancelPractice(admin as never, 'lesson-1', {}),
        );

        expect(error.message).toBe(LESSON_NOT_CANCELLABLE_MESSAGE);
      });

      it.each([
        ['already started', '2026-10-21T09:30:00.000Z'],
        ['starting right now', NOW.toISOString()],
      ])('refuses a lesson that is %s', async (_, scheduledAt) => {
        givenPractice(
          practiceRow({ lesson: { scheduledAt: new Date(scheduledAt) } }),
        );

        const error = await caught(
          service.cancelPractice(admin as never, 'lesson-1', {}),
        );

        expect(error).toBeInstanceOf(ConflictException);
        expect(error.message).toBe(LESSON_CANCEL_STARTED_MESSAGE);
        expect(prisma.drivingLesson.update).not.toHaveBeenCalled();
      });

      it.each([
        [
          'a blocked instructor',
          { instructor: { status: UserStatus.BLOCKED } },
        ],
        [
          'a dropped student',
          { profile: { trainingStatus: TrainingStatus.DROPPED } },
        ],
      ])('still cancels a lesson with %s', async (_, overrides) => {
        givenPractice(practiceRow(overrides));

        await service.cancelPractice(admin as never, 'lesson-1', {});

        expect(prisma.drivingLesson.update).toHaveBeenCalledTimes(1);
      });

      it('does not check the car, conflicts or schedule locks', async () => {
        prisma.car.findUnique.mockResolvedValue({
          ...availableCar,
          status: CarStatus.MAINTENANCE,
        });

        await service.cancelPractice(admin as never, 'lesson-1', {});

        expect(prisma.car.findUnique).not.toHaveBeenCalled();
        expect(prisma.drivingLesson.findMany).not.toHaveBeenCalled();
        expect(prisma.lesson.findMany).not.toHaveBeenCalled();
        expect(prisma.$executeRaw).not.toHaveBeenCalled();
        expect(prisma.drivingLesson.update).toHaveBeenCalledTimes(1);
      });

      it('logs ids without the reason or personal data', async () => {
        await service.cancelPractice(admin as never, 'lesson-1', {
          reason: 'Марія захворіла',
        });

        expect(log).toHaveBeenCalledWith(
          'Lesson cancelled type=PRACTICE lessonId=lesson-1 ' +
            'scheduledAt=2026-11-02T08:00:00.000Z actorId=admin-1 organizationId=org-1',
        );
        const logged = log.mock.calls.flat().join(' ');
        expect(logged).not.toContain('захворіла');
        expect(logged).not.toContain('Марія');
      });
    });

    describe('theory', () => {
      it('lets the group teacher cancel a future lesson', async () => {
        const result = await service.cancelTheory(
          teacherActor as never,
          'lesson-t1',
          { reason: 'Викладач захворів' },
        );

        expect(updateData(prisma.lesson.update)).toEqual({
          status: LessonStatus.CANCELLED,
          cancelledAt: NOW,
          cancelledById: 'teacher-1',
          cancellationReason: 'Викладач захворів',
        });
        expect(result).toMatchObject({
          id: 'lesson-t1',
          type: 'THEORY',
          status: LessonStatus.CANCELLED,
          cancelledAt: NOW,
          cancellationReason: 'Викладач захворів',
          group: { id: 'group-1', name: 'ПДР — Група А' },
        });
        expect(log).toHaveBeenCalledWith(
          'Lesson cancelled type=THEORY lessonId=lesson-t1 ' +
            'scheduledAt=2026-11-03T16:00:00.000Z actorId=teacher-1 organizationId=org-1',
        );
      });

      it('forbids a teacher of another group', async () => {
        givenTheory(theoryRow({ group: { teacherId: 'teacher-2' } }));

        const error = await caught(
          service.cancelTheory(teacherActor as never, 'lesson-t1', {}),
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(prisma.lesson.update).not.toHaveBeenCalled();
      });

      it.each([
        ['INSTRUCTOR', instructorActor],
        ['STUDENT', studentActor],
        ['OWNER', ownerActor],
      ])('forbids %s without touching the database', async (_, actor) => {
        const error = await caught(
          service.cancelTheory(actor as never, 'lesson-t1', {}),
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('returns 404 for a lesson of another organization without locking', async () => {
        prisma.lesson.findFirst.mockResolvedValue(null);

        const error = await caught(
          service.cancelTheory(admin as never, 'lesson-t1', {}),
        );

        expect(error).toBeInstanceOf(NotFoundException);
        expect(prisma.lesson.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'lesson-t1', group: { organizationId: 'org-1' } },
          }),
        );
        expect(prisma.$queryRaw).not.toHaveBeenCalled();
      });

      it('locks the group, then the lesson, then writes without schedule locks', async () => {
        await service.cancelTheory(admin as never, 'lesson-t1', {});

        expect(rawSql(prisma.$queryRaw, 0)).toBe(
          'SELECT id FROM groups WHERE id = $1::uuid AND organization_id = $2::uuid FOR SHARE',
        );
        expect(rawSql(prisma.$queryRaw, 1)).toContain('FOR UPDATE OF l');
        const order = [
          prisma.$queryRaw.mock.invocationCallOrder[0],
          prisma.$queryRaw.mock.invocationCallOrder[1],
          prisma.lesson.findFirst.mock.invocationCallOrder[1],
          prisma.lesson.update.mock.invocationCallOrder[0],
        ];
        expect(order).toEqual([...order].sort((a, b) => a - b));
        expect(prisma.$executeRaw).not.toHaveBeenCalled();
        expect(prisma.lesson.findMany).not.toHaveBeenCalled();
        expect(prisma.drivingLesson.findMany).not.toHaveBeenCalled();
      });

      it.each([LessonStatus.COMPLETED, LessonStatus.CANCELLED])(
        'refuses a %s lesson and reports its status',
        async (status) => {
          givenTheory(theoryRow({ lesson: { status } }));

          const error = await caught(
            service.cancelTheory(admin as never, 'lesson-t1', {}),
          );

          expect(error.getResponse()).toEqual({
            statusCode: 409,
            message: LESSON_NOT_CANCELLABLE_MESSAGE,
            error: 'Conflict',
            currentStatus: status,
          });
          expect(prisma.lesson.update).not.toHaveBeenCalled();
        },
      );

      it.each([GroupStatus.COMPLETED, GroupStatus.ARCHIVED])(
        'refuses a lesson of a %s group',
        async (status) => {
          givenTheory(theoryRow({ group: { status } }));

          const error = await caught(
            service.cancelTheory(admin as never, 'lesson-t1', {}),
          );

          expect(error).toBeInstanceOf(ConflictException);
          expect(error.message).toBe(LESSON_GROUP_CLOSED_MESSAGE);
          expect(prisma.lesson.update).not.toHaveBeenCalled();
        },
      );

      it('refuses a lesson that already started', async () => {
        givenTheory(
          theoryRow({
            lesson: { scheduledAt: new Date('2026-10-21T09:00:00.000Z') },
          }),
        );

        const error = await caught(
          service.cancelTheory(admin as never, 'lesson-t1', {}),
        );

        expect(error).toBeInstanceOf(ConflictException);
        expect(error.message).toBe(LESSON_CANCEL_STARTED_MESSAGE);
      });

      it('still cancels when the teacher is blocked', async () => {
        givenTheory(theoryRow({ teacher: { status: UserStatus.BLOCKED } }));

        await service.cancelTheory(admin as never, 'lesson-t1', {});

        expect(prisma.lesson.update).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('create', () => {
    function studentRow(
      overrides: { student?: object; profile?: object } = {},
    ) {
      return {
        id: 'student-1',
        firstName: 'Марія',
        lastName: 'Коваль',
        status: UserStatus.ACTIVE as UserStatus,
        deletedAt: null as Date | null,
        studentProfile: {
          trainingStatus: TrainingStatus.PRACTICE as TrainingStatus,
          category: LicenseCategory.B as LicenseCategory | null,
          transmission: Transmission.MANUAL as Transmission | null,
          instructorId: 'instructor-1' as string | null,
          carId: 'car-1' as string | null,
          ...overrides.profile,
        },
        ...overrides.student,
      };
    }

    function givenGroup(group: ReturnType<typeof theoryRow>['group'] | null) {
      prisma.group.findFirst.mockResolvedValue(group);
    }

    function createData(mock: jest.Mock): unknown {
      expect(mock).toHaveBeenCalledTimes(1);
      return (mock.mock.calls[0] as [{ data: unknown }])[0].data;
    }

    beforeEach(() => {
      givenGroup(theoryRow().group);
      prisma.lesson.create.mockImplementation(({ data }: { data: object }) =>
        Promise.resolve({
          ...theoryRow({ lesson: { id: 'lesson-new' } }),
          ...data,
        }),
      );
      prisma.user.findFirst.mockResolvedValue(studentRow());
      prisma.drivingLesson.create.mockImplementation(
        ({ data }: { data: object }) =>
          Promise.resolve({
            ...practiceRow({ lesson: { id: 'lesson-new' } }),
            ...data,
          }),
      );
    });

    describe('theory', () => {
      const payload = {
        groupId: 'group-1',
        topic: 'Дорожні знаки',
        scheduledAt: '2026-11-03T18:00:00+02:00',
      };

      it('creates a lesson of the group and returns it', async () => {
        const result = await service.createTheory(admin as never, payload);

        expect(createData(prisma.lesson.create)).toEqual({
          groupId: 'group-1',
          topic: 'Дорожні знаки',
          scheduledAt: new Date('2026-11-03T16:00:00.000Z'),
          durationMin: 90,
        });
        expect(result).toEqual({
          id: 'lesson-new',
          type: 'THEORY',
          status: LessonStatus.SCHEDULED,
          topic: 'Дорожні знаки',
          scheduledAt: new Date('2026-11-03T16:00:00.000Z'),
          endsAt: new Date('2026-11-03T17:30:00.000Z'),
          durationMin: 90,
          group: { id: 'group-1', name: 'ПДР — Група А' },
          teacher: { id: 'teacher-1', firstName: 'Ірина', lastName: 'Мельник' },
          cancelledAt: null,
          cancellationReason: null,
          updatedAt: new Date('2026-10-20T09:00:00.000Z'),
        });
      });

      it('checks conflicts for the default 90 minutes, or for the given duration', async () => {
        // Інше заняття групи о 17:00 UTC: перетинає 16:00–17:30, але не 16:00–16:45.
        prisma.lesson.findMany.mockResolvedValue([
          {
            id: 'lesson-t2',
            groupId: 'group-1',
            scheduledAt: new Date('2026-11-03T17:00:00.000Z'),
            durationMin: 60,
            group: { teacherId: 'teacher-1' },
          },
        ]);

        const error = await caught(
          service.createTheory(admin as never, payload),
        );
        expect(error).toBeInstanceOf(ConflictException);

        await service.createTheory(admin as never, {
          ...payload,
          durationMin: 45,
        });
        expect(createData(prisma.lesson.create)).toMatchObject({
          durationMin: 45,
        });
      });

      it('lets the group teacher create a lesson', async () => {
        await service.createTheory(teacherActor as never, payload);

        expect(prisma.lesson.create).toHaveBeenCalledTimes(1);
      });

      it('forbids a teacher of another group', async () => {
        givenGroup(theoryRow({ group: { teacherId: 'teacher-2' } }).group);

        const error = await caught(
          service.createTheory(teacherActor as never, payload),
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(prisma.lesson.create).not.toHaveBeenCalled();
      });

      it.each([
        ['INSTRUCTOR', instructorActor],
        ['STUDENT', studentActor],
        ['OWNER', ownerActor],
      ])('forbids %s without touching the database', async (_, actor) => {
        const error = await caught(
          service.createTheory(actor as never, payload),
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(prisma.organization.findUnique).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('returns 404 for a group of another organization', async () => {
        givenGroup(null);

        const error = await caught(
          service.createTheory(admin as never, payload),
        );

        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.message).toBe(GROUP_NOT_FOUND_MESSAGE);
        expect(prisma.group.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'group-1', organizationId: 'org-1' },
          }),
        );
        expect(prisma.lesson.create).not.toHaveBeenCalled();
      });

      it.each([GroupStatus.COMPLETED, GroupStatus.ARCHIVED])(
        'refuses a %s group',
        async (status) => {
          givenGroup(theoryRow({ group: { status } }).group);

          const error = await caught(
            service.createTheory(admin as never, payload),
          );

          expect(error).toBeInstanceOf(ConflictException);
          expect(error.message).toBe(LESSON_GROUP_NOT_OPEN_MESSAGE);
          expect(prisma.lesson.create).not.toHaveBeenCalled();
        },
      );

      it('accepts a PLANNED group', async () => {
        givenGroup(theoryRow({ group: { status: GroupStatus.PLANNED } }).group);

        await service.createTheory(admin as never, payload);

        expect(prisma.lesson.create).toHaveBeenCalledTimes(1);
      });

      it.each([
        ['in the past', '2026-10-20T10:00:00Z'],
        ['exactly now', '2026-10-21T10:00:00Z'],
      ])(
        'rejects a start %s as a scheduledAt error before any query',
        async (_, scheduledAt) => {
          const error = await caught(
            service.createTheory(admin as never, { ...payload, scheduledAt }),
          );

          expect(error).toBeInstanceOf(BadRequestException);
          expect(error.getResponse()).toEqual({
            statusCode: 400,
            errors: [
              { field: 'scheduledAt', message: LESSON_CREATE_IN_PAST_MESSAGE },
            ],
          });
          expect(prisma.organization.findUnique).not.toHaveBeenCalled();
          expect(prisma.$transaction).not.toHaveBeenCalled();
        },
      );

      it('rejects a day outside the group dates', async () => {
        givenGroup(
          theoryRow({
            group: {
              startDate: new Date('2026-09-01T00:00:00.000Z'),
              endDate: new Date('2026-11-02T00:00:00.000Z'),
            },
          }).group,
        );

        const error = await caught(
          service.createTheory(admin as never, payload),
        );

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.getResponse()).toEqual({
          statusCode: 400,
          errors: [
            {
              field: 'scheduledAt',
              message: LESSON_OUTSIDE_GROUP_DATES_MESSAGE,
            },
          ],
        });
      });

      it('requires an active teacher', async () => {
        givenGroup(
          theoryRow({ teacher: { status: UserStatus.BLOCKED } }).group,
        );

        const error = await caught(
          service.createTheory(admin as never, payload),
        );

        expect(error).toBeInstanceOf(ConflictException);
        expect(error.message).toBe(LESSON_TEACHER_NOT_ACTIVE_MESSAGE);
      });

      it('refuses a conflicting slot and logs it as a new lesson', async () => {
        prisma.drivingLesson.findMany.mockResolvedValue([
          {
            id: 'practice-1',
            studentId: 'student-7',
            scheduledAt: new Date('2026-11-03T16:30:00.000Z'),
            durationMin: 60,
          },
        ]);

        const error = await caught(
          service.createTheory(admin as never, payload),
        );

        expect(error).toBeInstanceOf(ConflictException);
        const body = error.getResponse() as {
          conflicts: { resource: string; lessonId: string }[];
        };
        expect(body.conflicts).toMatchObject([
          { resource: 'STUDENT', lessonId: 'practice-1' },
        ]);
        expect(prisma.lesson.create).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith(
          'Lesson schedule conflict type=THEORY lessonId=new conflicts=1 actorId=admin-1 organizationId=org-1',
        );
      });

      it('locks the group, then reads it, then the resources, then writes', async () => {
        await service.createTheory(admin as never, payload);

        expect(rawSql(prisma.$queryRaw, 0)).toBe(
          'SELECT id FROM groups WHERE id = $1::uuid AND organization_id = $2::uuid FOR SHARE',
        );
        expect(advisoryKeys()).toEqual(['group:group-1', 'teacher:teacher-1']);
        const order = [
          prisma.$queryRaw.mock.invocationCallOrder[0],
          prisma.group.findFirst.mock.invocationCallOrder[0],
          prisma.$executeRaw.mock.invocationCallOrder[0],
          prisma.lesson.findMany.mock.invocationCallOrder[0],
          prisma.lesson.create.mock.invocationCallOrder[0],
        ];
        expect(order).toEqual([...order].sort((a, b) => a - b));
        const [theoryArgs] = prisma.lesson.findMany.mock.calls[0] as [
          { where: object },
        ];
        expect(theoryArgs.where).not.toHaveProperty('id');
      });

      it('logs ids without the topic or personal data', async () => {
        await service.createTheory(admin as never, payload);

        expect(log).toHaveBeenCalledWith(
          'Lesson created type=THEORY lessonId=lesson-new groupId=group-1 ' +
            'scheduledAt=2026-11-03T16:00:00.000Z durationMin=90 actorId=admin-1 organizationId=org-1',
        );
        const logged = log.mock.calls.flat().join(' ');
        expect(logged).not.toContain('Дорожні знаки');
        expect(logged).not.toContain('Ірина');
      });
    });

    describe('practice', () => {
      const payload = {
        studentId: 'student-1',
        scheduledAt: '2026-11-03T10:00:00+02:00',
      };

      it("takes the instructor and car from the student's practice access", async () => {
        const result = await service.createPractice(admin as never, payload);

        expect(createData(prisma.drivingLesson.create)).toEqual({
          organizationId: 'org-1',
          instructorId: 'instructor-1',
          studentId: 'student-1',
          carId: 'car-1',
          scheduledAt: new Date('2026-11-03T08:00:00.000Z'),
          durationMin: 60,
        });
        expect(result).toMatchObject({
          id: 'lesson-new',
          type: 'PRACTICE',
          status: DrivingLessonStatus.SCHEDULED,
          scheduledAt: new Date('2026-11-03T08:00:00.000Z'),
          endsAt: new Date('2026-11-03T09:00:00.000Z'),
          durationMin: 60,
          student: { id: 'student-1', firstName: 'Марія', lastName: 'Коваль' },
          car: { id: 'car-1', plateNumber: 'AA1234BB' },
        });
      });

      it('looks the student up only in the actor organization', async () => {
        await service.createPractice(admin as never, payload);

        expect(prisma.user.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              id: 'student-1',
              organizationId: 'org-1',
              role: UserRole.STUDENT,
              deletedAt: null,
              studentProfile: { is: { organizationId: 'org-1' } },
            },
          }),
        );
      });

      it('uses the instructor, car and duration from the request', async () => {
        prisma.car.findUnique.mockResolvedValue({
          ...availableCar,
          instructorId: 'instructor-2',
        });

        await service.createPractice(admin as never, {
          ...payload,
          instructorId: 'instructor-2',
          carId: 'car-2',
          durationMin: 90,
        });

        expect(createData(prisma.drivingLesson.create)).toMatchObject({
          instructorId: 'instructor-2',
          carId: 'car-2',
          durationMin: 90,
        });
      });

      it("refuses another instructor with the student's car", async () => {
        const error = await caught(
          service.createPractice(admin as never, {
            ...payload,
            instructorId: 'instructor-2',
          }),
        );

        expect(error).toBeInstanceOf(ConflictException);
        expect(error.message).toBe(INSTRUCTOR_CAR_MISMATCH_MESSAGE);
        expect(prisma.drivingLesson.create).not.toHaveBeenCalled();
      });

      it.each([
        [
          'an instructor',
          { instructorId: null },
          PRACTICE_INSTRUCTOR_REQUIRED_MESSAGE,
        ],
        ['a car', { carId: null }, PRACTICE_CAR_REQUIRED_MESSAGE],
      ])(
        'requires %s when neither the request nor the student has one',
        async (_, profile, message) => {
          prisma.user.findFirst.mockResolvedValue(studentRow({ profile }));

          const error = await caught(
            service.createPractice(admin as never, payload),
          );

          expect(error).toBeInstanceOf(ConflictException);
          expect(error.message).toBe(message);
          expect(prisma.drivingLesson.create).not.toHaveBeenCalled();
        },
      );

      it('makes the instructor actor the instructor of the lesson', async () => {
        await service.createPractice(instructorActor as never, payload);

        expect(createData(prisma.drivingLesson.create)).toMatchObject({
          instructorId: 'instructor-1',
        });
      });

      it('lets an instructor pass their own id', async () => {
        await service.createPractice(instructorActor as never, {
          ...payload,
          instructorId: 'instructor-1',
        });

        expect(prisma.drivingLesson.create).toHaveBeenCalledTimes(1);
      });

      it('forbids an instructor from booking another instructor before the transaction', async () => {
        const error = await caught(
          service.createPractice(instructorActor as never, {
            ...payload,
            instructorId: 'instructor-2',
          }),
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(error.message).toBe(LESSON_INSTRUCTOR_ASSIGN_MESSAGE);
        expect(prisma.organization.findUnique).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('forbids an instructor from booking a student of another instructor', async () => {
        prisma.user.findFirst.mockResolvedValue(
          studentRow({ profile: { instructorId: 'instructor-2' } }),
        );

        const error = await caught(
          service.createPractice(instructorActor as never, payload),
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(error.message).toBe(STUDENT_NOT_ASSIGNED_MESSAGE);
        expect(prisma.drivingLesson.create).not.toHaveBeenCalled();
      });

      it.each([
        ['TEACHER', teacherActor],
        ['STUDENT', studentActor],
        ['OWNER', ownerActor],
      ])('forbids %s without touching the database', async (_, actor) => {
        const error = await caught(
          service.createPractice(actor as never, payload),
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(prisma.organization.findUnique).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('returns 404 for a student of another organization', async () => {
        prisma.user.findFirst.mockResolvedValue(null);

        const error = await caught(
          service.createPractice(admin as never, payload),
        );

        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.message).toBe(STUDENT_NOT_FOUND_MESSAGE);
      });

      it.each([
        [
          'without practice access',
          { profile: { trainingStatus: TrainingStatus.ACTIVE } },
        ],
        ['blocked', { student: { status: UserStatus.BLOCKED } }],
      ])('refuses a student %s', async (_, overrides) => {
        prisma.user.findFirst.mockResolvedValue(studentRow(overrides));

        const error = await caught(
          service.createPractice(admin as never, payload),
        );

        expect(error).toBeInstanceOf(ConflictException);
        expect(error.message).toBe(STUDENT_NOT_IN_PRACTICE_MESSAGE);
      });

      it.each([
        [
          'an instructor of another organization',
          () =>
            prisma.user.findUnique.mockResolvedValue({
              ...activeInstructor,
              organizationId: 'org-2',
            }),
          NotFoundException,
          INSTRUCTOR_NOT_FOUND_MESSAGE,
        ],
        [
          'a blocked instructor',
          () =>
            prisma.user.findUnique.mockResolvedValue({
              ...activeInstructor,
              status: UserStatus.BLOCKED,
            }),
          ConflictException,
          INSTRUCTOR_NOT_ACTIVE_MESSAGE,
        ],
        [
          'a user who is not an instructor',
          () =>
            prisma.user.findUnique.mockResolvedValue({
              ...activeInstructor,
              role: UserRole.TEACHER,
            }),
          ConflictException,
          INSTRUCTOR_ROLE_MESSAGE,
        ],
        [
          'a car of another organization',
          () =>
            prisma.car.findUnique.mockResolvedValue({
              ...availableCar,
              organizationId: 'org-2',
            }),
          NotFoundException,
          CAR_NOT_FOUND_MESSAGE,
        ],
        [
          'a car in maintenance',
          () =>
            prisma.car.findUnique.mockResolvedValue({
              ...availableCar,
              status: CarStatus.MAINTENANCE,
            }),
          ConflictException,
          CAR_NOT_AVAILABLE_MESSAGE,
        ],
      ])('refuses %s', async (_, given, type, message) => {
        given();

        const error = await caught(
          service.createPractice(admin as never, payload),
        );

        expect(error).toBeInstanceOf(type);
        expect(error.message).toBe(message);
        expect(prisma.drivingLesson.create).not.toHaveBeenCalled();
      });

      it.each([
        ['in the past', '2026-10-20T10:00:00Z'],
        ['exactly now', '2026-10-21T10:00:00Z'],
      ])(
        'rejects a start %s as a scheduledAt error before any query',
        async (_, scheduledAt) => {
          const error = await caught(
            service.createPractice(admin as never, { ...payload, scheduledAt }),
          );

          expect(error).toBeInstanceOf(BadRequestException);
          expect(error.getResponse()).toEqual({
            statusCode: 400,
            errors: [
              { field: 'scheduledAt', message: LESSON_CREATE_IN_PAST_MESSAGE },
            ],
          });
          expect(prisma.organization.findUnique).not.toHaveBeenCalled();
          expect(prisma.$transaction).not.toHaveBeenCalled();
        },
      );

      it("locks the instructor, car, student and the student's open groups", async () => {
        prisma.enrollment.findMany.mockResolvedValue([
          { groupId: 'group-1' },
          { groupId: 'group-2' },
        ]);

        await service.createPractice(admin as never, payload);

        expect(advisoryKeys()).toEqual([
          'car:car-1',
          'group:group-1',
          'group:group-2',
          'instructor:instructor-1',
          'student:student-1',
        ]);
        expect(prisma.$queryRaw).not.toHaveBeenCalled();
        const order = [
          prisma.user.findFirst.mock.invocationCallOrder[0],
          prisma.$executeRaw.mock.invocationCallOrder[0],
          prisma.drivingLesson.findMany.mock.invocationCallOrder[0],
          prisma.drivingLesson.create.mock.invocationCallOrder[0],
        ];
        expect(order).toEqual([...order].sort((a, b) => a - b));
      });

      it('refuses a conflicting slot and logs it as a new lesson', async () => {
        prisma.drivingLesson.findMany.mockResolvedValue([
          {
            id: 'lesson-2',
            instructorId: 'instructor-1',
            carId: 'car-9',
            studentId: 'student-2',
            scheduledAt: new Date('2026-11-03T08:30:00.000Z'),
            durationMin: 60,
          },
        ]);

        const error = await caught(
          service.createPractice(admin as never, payload),
        );

        expect(error).toBeInstanceOf(ConflictException);
        const body = error.getResponse() as {
          conflicts: { resource: string; lessonId: string }[];
        };
        expect(body.conflicts).toMatchObject([
          { resource: 'INSTRUCTOR', lessonId: 'lesson-2' },
        ]);
        expect(prisma.drivingLesson.create).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith(
          'Lesson schedule conflict type=PRACTICE lessonId=new conflicts=1 actorId=admin-1 organizationId=org-1',
        );
      });

      it('logs ids without personal data', async () => {
        await service.createPractice(admin as never, payload);

        expect(log).toHaveBeenCalledWith(
          'Lesson created type=PRACTICE lessonId=lesson-new instructorId=instructor-1 studentId=student-1 ' +
            'carId=car-1 scheduledAt=2026-11-03T08:00:00.000Z durationMin=60 actorId=admin-1 organizationId=org-1',
        );
        const logged = log.mock.calls.flat().join(' ');
        expect(logged).not.toContain('Марія');
        expect(logged).not.toContain('Олег');
      });
    });
  });
});
