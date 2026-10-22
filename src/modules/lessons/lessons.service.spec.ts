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
import {
  CAR_NOT_AVAILABLE_MESSAGE,
  INSTRUCTOR_CAR_MISMATCH_MESSAGE,
} from '../students/students.service';
import {
  LESSON_ALREADY_STARTED_MESSAGE,
  LESSON_GROUP_CLOSED_MESSAGE,
  LESSON_IN_PAST_MESSAGE,
  LESSON_INSTRUCTOR_CHANGE_MESSAGE,
  LESSON_NOT_EDITABLE_MESSAGE,
  LESSON_NOT_FOUND_MESSAGE,
  LESSON_OUTSIDE_GROUP_DATES_MESSAGE,
  LESSON_TEACHER_NOT_ACTIVE_MESSAGE,
  LessonsService,
  NO_PRACTICE_LESSON_FIELDS_MESSAGE,
  NO_THEORY_LESSON_FIELDS_MESSAGE,
  PRACTICE_CAR_REQUIRED_MESSAGE,
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
    lesson: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    drivingLesson: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    enrollment: { findMany: jest.fn() },
    user: { findUnique: jest.fn() },
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
});
