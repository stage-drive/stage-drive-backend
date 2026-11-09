import { execFileSync } from 'child_process';
import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  AttendanceStatus,
  BookingConfirmation,
  CarStatus,
  DayOfWeek,
  EnrollmentStatus,
  GroupStatus,
  LessonStatus,
  LicenseCategory,
  PaymentStatus,
  PrismaClient,
  TimeOffType,
  TrainingStatus,
  Transmission,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { lockGroup } from '../../src/common/prisma/group-lock';
import { localDate } from '../../src/common/time/zoned-time';
import {
  lockPracticeLesson,
  lockScheduleResources,
  lockTheoryLesson,
  scheduleLockKey,
} from '../../src/common/prisma/schedule-lock';
import { DashboardService } from '../../src/modules/dashboard/dashboard.service';
import {
  GROUP_CLOSED_CANCELLATION_REASON,
  GroupsService,
} from '../../src/modules/groups/groups.service';
import type { InvitationEmailQueue } from '../../src/modules/invitations/invitation-email.queue';
import { InstructorScheduleService } from '../../src/modules/lessons/instructor-schedule.service';
import type { LessonAttendanceDto } from '../../src/modules/lessons/lesson-attendance.dto';
import {
  ATTENDANCE_GROUP_CLOSED_MESSAGE,
  ATTENDANCE_NOT_STARTED_MESSAGE,
  LessonAttendanceService,
} from '../../src/modules/lessons/lesson-attendance.service';
import {
  LESSON_GROUP_CLOSED_MESSAGE,
  LESSON_GROUP_NOT_OPEN_MESSAGE,
  LESSON_HAS_ATTENDANCE_MESSAGE,
  LESSON_NOT_CANCELLABLE_MESSAGE,
  LessonsService,
} from '../../src/modules/lessons/lessons.service';
import type { PersonalScheduleDto } from '../../src/modules/lessons/lessons.dto';
import { PersonalScheduleService } from '../../src/modules/lessons/personal-schedule.service';
import {
  BOOKING_NOT_PENDING_MESSAGE,
  PracticeLessonWorkflowService,
} from '../../src/modules/lessons/practice-lesson-workflow.service';
import {
  PracticeLessonsService,
  SLOT_NOT_OPEN_MESSAGE,
  STUDENT_HAS_ACTIVE_LESSON_MESSAGE,
} from '../../src/modules/lessons/practice-lessons.service';
import { PracticePaymentService } from '../../src/modules/lessons/practice-payment.service';
import {
  BOOKING_EXPIRED_REASON,
  PracticeRequestExpiryJob,
} from '../../src/modules/lessons/practice-request-expiry.job';
import type { LessonConflict } from '../../src/modules/lessons/schedule-conflicts';
import {
  STUDENT_PRACTICE_ACCESS_MESSAGE,
  StudentsService,
} from '../../src/modules/students/students.service';
import type { PrismaService } from '../../src/prisma/prisma.service';

/** How long a blocked request must stay pending to count as waiting on the lock. */
const LOCK_WAIT_MS = 300;
/** An unblocked request must finish well before the 5 s transaction timeout. */
const UNBLOCKED_WITHIN_MS = 2000;

const MINUTE_MS = 60_000;

/** A day a week ahead (UTC midnight), so every slot is in the future whenever the suite runs. */
const DAY = (() => {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 7),
  );
})();

function at(hour: number, minute = 0): Date {
  return new Date(DAY.getTime() + (hour * 60 + minute) * MINUTE_MS);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function delay(ms: number) {
  return new Promise((done) => setTimeout(done, ms));
}

function track(promise: Promise<unknown>) {
  const state = { settled: false };
  promise.then(
    () => (state.settled = true),
    () => (state.settled = true),
  );
  return state;
}

async function conflictsOf(promise: Promise<unknown>): Promise<string[]> {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ConflictException);
  const body = (error as ConflictException).getResponse() as {
    conflicts: LessonConflict[];
  };
  return body.conflicts.map((c) => `${c.resource}/${c.lessonType}`);
}

/**
 * Real LessonsService against real Postgres: the conflict queries, the CHECK
 * from the migration and the lock order. Competing requests are raw
 * transactions that take the same lock and pause, so interleavings are
 * deterministic.
 */
describe('Lesson schedule (integration, real Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let lessonsService: LessonsService;
  let groupsService: GroupsService;
  let dashboardService: DashboardService;
  let scheduleService: PersonalScheduleService;
  let attendanceService: LessonAttendanceService;
  let instructorScheduleService: InstructorScheduleService;
  let practiceLessonsService: PracticeLessonsService;
  let studentsService: StudentsService;
  let workflowService: PracticeLessonWorkflowService;
  let expiryJob: PracticeRequestExpiryJob;
  let sequence = 0;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const databaseUrl = container.getConnectionUri();

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    });

    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    });
    await prisma.$connect();

    const service = prisma as unknown as PrismaService;
    const payment = new PracticePaymentService();
    lessonsService = new LessonsService(service, payment);
    studentsService = new StudentsService(service, {} as InvitationEmailQueue);
    groupsService = new GroupsService(service, studentsService);
    dashboardService = new DashboardService(service);
    scheduleService = new PersonalScheduleService(service);
    attendanceService = new LessonAttendanceService(service);
    instructorScheduleService = new InstructorScheduleService(service);
    practiceLessonsService = new PracticeLessonsService(service, payment);
    workflowService = new PracticeLessonWorkflowService(service);
    expiryJob = new PracticeRequestExpiryJob(service);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  /**
   * One school: instructor with cars 1 and 2, another instructor with car 3,
   * a teacher's ACTIVE group, and two PRACTICE students enrolled in it.
   */
  async function createSchool() {
    sequence += 1;
    const organization = await prisma.organization.create({
      data: {
        name: `Lessons School ${sequence}`,
        slug: `lessons-school-${sequence}`,
        email: `lessons-${sequence}@example.com`,
      },
    });
    const userData = (role: UserRole, suffix: string) => ({
      organizationId: organization.id,
      email: `${role.toLowerCase()}-${suffix}-${sequence}@lessons.example.com`,
      firstName: 'Lessons',
      lastName: role,
      role,
    });
    const admin: User = await prisma.user.create({
      data: userData(UserRole.ADMIN, 'a'),
    });
    const teacher: User = await prisma.user.create({
      data: userData(UserRole.TEACHER, 't'),
    });
    const instructor = await prisma.user.create({
      data: userData(UserRole.INSTRUCTOR, 'i1'),
    });
    const otherInstructor = await prisma.user.create({
      data: userData(UserRole.INSTRUCTOR, 'i2'),
    });
    const car = (instructorId: string, n: number) =>
      prisma.car.create({
        data: {
          organizationId: organization.id,
          instructorId,
          plateNumber: `AA${sequence}0${n}BB`,
          category: LicenseCategory.B,
          transmission: Transmission.MANUAL,
        },
      });
    const car1 = await car(instructor.id, 1);
    const car2 = await car(instructor.id, 2);
    const car3 = await car(otherInstructor.id, 3);
    const group = await prisma.group.create({
      data: {
        name: `Група ${sequence}`,
        status: GroupStatus.ACTIVE,
        organizationId: organization.id,
        teacherId: teacher.id,
      },
    });
    const student = (n: number, carId: string) =>
      prisma.user.create({
        data: {
          ...userData(UserRole.STUDENT, `s${n}`),
          studentProfile: {
            create: {
              organizationId: organization.id,
              groupId: group.id,
              instructorId: instructor.id,
              carId,
              category: LicenseCategory.B,
              transmission: Transmission.MANUAL,
              trainingStatus: TrainingStatus.PRACTICE,
            },
          },
          enrollments: {
            create: { groupId: group.id, status: EnrollmentStatus.ACTIVE },
          },
        },
      });
    const student1 = await student(1, car1.id);
    const student2 = await student(2, car2.id);

    const practice = (data: {
      instructorId?: string;
      carId?: string;
      studentId?: string;
      scheduledAt: Date;
      durationMin?: number;
      status?: LessonStatus;
      cancelledAt?: Date;
    }) =>
      prisma.drivingLesson.create({
        data: {
          organizationId: organization.id,
          instructorId: instructor.id,
          carId: car1.id,
          studentId: student1.id,
          // Явно 60 хв: часові сценарії тестів написані під годинні заняття,
          // а з міграції drop_practice_slots @default — 120.
          durationMin: 60,
          ...data,
        },
      });
    const theory = (scheduledAt: Date, durationMin = 90) =>
      prisma.lesson.create({
        data: {
          organizationId: organization.id,
          groupId: group.id,
          topic: 'Дорожні знаки',
          scheduledAt,
          durationMin,
        },
      });

    return {
      organization,
      admin,
      teacher,
      instructor,
      otherInstructor,
      car1,
      car2,
      car3,
      group,
      student1,
      student2,
      practice,
      theory,
    };
  }

  describe('migration', () => {
    it('rejects a duration outside 15–240 minutes in both tables', async () => {
      const school = await createSchool();

      await expect(
        school.practice({ scheduledAt: at(10), durationMin: 300 }),
      ).rejects.toThrow();
      await expect(school.theory(at(10), 10)).rejects.toThrow();
      await expect(
        school.practice({ scheduledAt: at(10), durationMin: 240 }),
      ).resolves.toMatchObject({ durationMin: 240 });
    });

    it('keeps cancelled_at and the reason consistent with the status', async () => {
      const school = await createSchool();
      const theory = (data: object) =>
        prisma.lesson.create({
          data: {
            organizationId: school.organization.id,
            groupId: school.group.id,
            topic: 'Дорожні знаки',
            scheduledAt: at(16),
            ...data,
          },
        });

      await expect(
        school.practice({
          scheduledAt: at(10),
          status: LessonStatus.CANCELLED,
        }),
      ).rejects.toThrow();
      await expect(
        school.practice({ scheduledAt: at(10), cancelledAt: new Date() }),
      ).rejects.toThrow();
      await expect(
        theory({ status: LessonStatus.CANCELLED }),
      ).rejects.toThrow();
      await expect(
        theory({ cancellationReason: 'Без скасування' }),
      ).rejects.toThrow();
      await expect(
        theory({
          status: LessonStatus.CANCELLED,
          cancelledAt: new Date(),
          cancellationReason: 'Викладач захворів',
        }),
      ).resolves.toMatchObject({ status: LessonStatus.CANCELLED });
    });

    it('links a driving lesson to an existing car only', async () => {
      const school = await createSchool();

      await expect(
        school.practice({
          scheduledAt: at(10),
          carId: '00000000-0000-4000-8000-000000000000',
        }),
      ).rejects.toThrow();
    });

    it('ties a theory lesson to a group of the same school', async () => {
      const school = await createSchool();
      const other = await createSchool();

      await expect(
        prisma.lesson.create({
          data: {
            organizationId: other.organization.id,
            groupId: school.group.id,
            topic: 'Чужа група',
            scheduledAt: at(16),
          },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
      await expect(school.theory(at(16))).resolves.toMatchObject({
        organizationId: school.organization.id,
      });
    });

    it('refuses to delete a person who has lesson history', async () => {
      const school = await createSchool();
      const lesson = await school.practice({ scheduledAt: at(10) });

      for (const person of [
        school.instructor,
        school.student1,
        school.teacher,
      ]) {
        await expect(
          prisma.user.delete({ where: { id: person.id } }),
        ).rejects.toMatchObject({ code: 'P2003' });
      }
      await expect(
        prisma.drivingLesson.findUnique({ where: { id: lesson.id } }),
      ).resolves.not.toBeNull();
      await expect(
        prisma.group.findUnique({ where: { id: school.group.id } }),
      ).resolves.not.toBeNull();
    });

    it('keeps the car without an instructor when the instructor is deleted', async () => {
      const school = await createSchool();

      await prisma.user.delete({ where: { id: school.otherInstructor.id } });

      await expect(
        prisma.car.findUnique({ where: { id: school.car3.id } }),
      ).resolves.toMatchObject({ instructorId: null });
    });

    it('still deletes a whole school with its lessons and people', async () => {
      const school = await createSchool();
      const other = await createSchool();
      const theory = await school.theory(at(16));
      await school.practice({ scheduledAt: at(10) });
      await prisma.lessonAttendance.create({
        data: {
          lessonId: theory.id,
          studentId: school.student1.id,
          status: AttendanceStatus.PRESENT,
          markedAt: new Date(),
        },
      });
      await other.practice({ scheduledAt: at(10) });

      await prisma.organization.delete({
        where: { id: school.organization.id },
      });

      const organizationId = school.organization.id;
      await expect(
        Promise.all([
          prisma.user.count({ where: { organizationId } }),
          prisma.lesson.count({ where: { organizationId } }),
          prisma.drivingLesson.count({ where: { organizationId } }),
          prisma.lessonAttendance.count({ where: { lessonId: theory.id } }),
        ]),
      ).resolves.toEqual([0, 0, 0, 0]);
      await expect(
        prisma.drivingLesson.count({
          where: { organizationId: other.organization.id },
        }),
      ).resolves.toBe(1);
    });
  });

  describe('conflict queries', () => {
    it('saves a reschedule to a free slot', async () => {
      const school = await createSchool();
      const lesson = await school.practice({ scheduledAt: at(10) });

      const result = await lessonsService.reschedulePractice(
        school.admin,
        lesson.id,
        { scheduledAt: at(14).toISOString() },
      );

      expect(result.scheduledAt).toEqual(at(14));
      const saved = await prisma.drivingLesson.findUniqueOrThrow({
        where: { id: lesson.id },
      });
      expect(saved.scheduledAt).toEqual(at(14));
      expect(saved.updatedAt.getTime()).toBeGreaterThan(
        lesson.updatedAt.getTime(),
      );
    });

    it('reports the instructor when only the instructor is busy', async () => {
      const school = await createSchool();
      await school.practice({ scheduledAt: at(10) });
      const moving = await school.practice({
        carId: school.car2.id,
        studentId: school.student2.id,
        scheduledAt: at(13),
      });

      await expect(
        conflictsOf(
          lessonsService.reschedulePractice(school.admin, moving.id, {
            scheduledAt: at(10, 30).toISOString(),
          }),
        ),
      ).resolves.toEqual(['INSTRUCTOR/PRACTICE']);
    });

    it('reports the car when another instructor uses it', async () => {
      const school = await createSchool();
      await school.practice({
        instructorId: school.otherInstructor.id,
        carId: school.car1.id,
        studentId: school.student2.id,
        scheduledAt: at(10),
      });
      const moving = await school.practice({ scheduledAt: at(13) });

      await expect(
        conflictsOf(
          lessonsService.reschedulePractice(school.admin, moving.id, {
            scheduledAt: at(10, 30).toISOString(),
          }),
        ),
      ).resolves.toEqual(['CAR/PRACTICE']);
    });

    it('reports a theory lesson of the student group', async () => {
      const school = await createSchool();
      await school.theory(at(16));
      const moving = await school.practice({ scheduledAt: at(10) });

      await expect(
        conflictsOf(
          lessonsService.reschedulePractice(school.admin, moving.id, {
            scheduledAt: at(16, 30).toISOString(),
          }),
        ),
      ).resolves.toEqual(['STUDENT/THEORY']);
    });

    it('reports practice of a group student when theory moves onto it', async () => {
      const school = await createSchool();
      await school.practice({ scheduledAt: at(10) });
      const moving = await school.theory(at(16));

      await expect(
        conflictsOf(
          lessonsService.rescheduleTheory(school.admin, moving.id, {
            scheduledAt: at(10, 30).toISOString(),
          }),
        ),
      ).resolves.toEqual(['STUDENT/PRACTICE']);
    });

    it('allows a lesson right after another one', async () => {
      const school = await createSchool();
      await school.practice({ scheduledAt: at(10) });
      const moving = await school.practice({
        carId: school.car2.id,
        studentId: school.student2.id,
        scheduledAt: at(13),
      });

      await expect(
        lessonsService.reschedulePractice(school.admin, moving.id, {
          scheduledAt: at(11).toISOString(),
        }),
      ).resolves.toMatchObject({ scheduledAt: at(11) });
    });

    it('ignores a cancelled lesson in the same slot', async () => {
      const school = await createSchool();
      await school.practice({
        scheduledAt: at(10),
        status: LessonStatus.CANCELLED,
        cancelledAt: new Date(),
      });
      const moving = await school.practice({ scheduledAt: at(13) });

      await expect(
        lessonsService.reschedulePractice(school.admin, moving.id, {
          scheduledAt: at(10).toISOString(),
        }),
      ).resolves.toMatchObject({ scheduledAt: at(10) });
    });

    it('does not find a lesson of another school', async () => {
      const school = await createSchool();
      const other = await createSchool();
      const foreign = await other.practice({ scheduledAt: at(10) });

      await expect(
        lessonsService.reschedulePractice(school.admin, foreign.id, {
          scheduledAt: at(14).toISOString(),
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('locks', () => {
    it('makes a reschedule wait for a booking of the same instructor and see it', async () => {
      const school = await createSchool();
      const moving = await school.practice({
        carId: school.car2.id,
        studentId: school.student2.id,
        scheduledAt: at(13),
      });
      const booked = deferred();
      const commit = deferred();

      // In-flight booking: holds the instructor key and has inserted 10:00.
      const booking = prisma.$transaction(async (tx) => {
        await lockScheduleResources(tx, [
          scheduleLockKey('instructor', school.instructor.id),
        ]);
        await tx.drivingLesson.create({
          data: {
            organizationId: school.organization.id,
            instructorId: school.instructor.id,
            carId: school.car1.id,
            studentId: school.student1.id,
            scheduledAt: at(10),
          },
        });
        booked.resolve();
        await commit.promise;
      });

      try {
        await booked.promise;
        const rescheduling = lessonsService.reschedulePractice(
          school.admin,
          moving.id,
          { scheduledAt: at(10).toISOString() },
        );
        const state = track(rescheduling);

        await delay(LOCK_WAIT_MS);
        expect(state.settled).toBe(false);

        commit.resolve();
        await booking;

        await expect(conflictsOf(rescheduling)).resolves.toEqual([
          'INSTRUCTOR/PRACTICE',
        ]);
        await expect(
          prisma.drivingLesson.findUniqueOrThrow({ where: { id: moving.id } }),
        ).resolves.toMatchObject({ scheduledAt: at(13) });
      } finally {
        commit.resolve();
        await booking.catch(() => undefined);
      }
    });

    it('lets only one of two parallel reschedules into the same slot win', async () => {
      const school = await createSchool();
      const first = await school.practice({ scheduledAt: at(8) });
      const second = await school.practice({
        carId: school.car2.id,
        studentId: school.student2.id,
        scheduledAt: at(13),
      });

      const results = await Promise.allSettled([
        lessonsService.reschedulePractice(school.admin, first.id, {
          scheduledAt: at(10).toISOString(),
        }),
        lessonsService.reschedulePractice(school.admin, second.id, {
          scheduledAt: at(10).toISOString(),
        }),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      const rejected = results.find((r) => r.status === 'rejected');
      expect(rejected?.reason).toBeInstanceOf(ConflictException);
      await expect(
        prisma.drivingLesson.count({
          where: { instructorId: school.instructor.id, scheduledAt: at(10) },
        }),
      ).resolves.toBe(1);
    });

    it('makes a theory reschedule wait for the group to close and then refuse', async () => {
      const school = await createSchool();
      const lesson = await school.theory(at(16));
      const closed = deferred();
      const commit = deferred();

      // In-flight changeStatus: holds FOR UPDATE and has saved COMPLETED.
      const closing = prisma.$transaction(async (tx) => {
        await lockGroup(tx, school.group.id, school.organization.id, 'update');
        await tx.group.update({
          where: { id: school.group.id },
          data: { status: GroupStatus.COMPLETED },
        });
        closed.resolve();
        await commit.promise;
      });

      try {
        await closed.promise;
        const rescheduling = lessonsService.rescheduleTheory(
          school.admin,
          lesson.id,
          { scheduledAt: at(18).toISOString() },
        );
        const state = track(rescheduling);

        await delay(LOCK_WAIT_MS);
        expect(state.settled).toBe(false);

        commit.resolve();
        await closing;

        const error: unknown = await rescheduling.catch(
          (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).message).toBe(
          LESSON_GROUP_CLOSED_MESSAGE,
        );
      } finally {
        commit.resolve();
        await closing.catch(() => undefined);
      }
    });

    it('does not deadlock when a group closes while its lesson is rescheduled', async () => {
      const school = await createSchool();
      const lesson = await school.theory(at(16));

      const settled = Promise.allSettled([
        groupsService.changeStatus(school.admin, school.group.id, {
          status: GroupStatus.COMPLETED,
        }),
        lessonsService.rescheduleTheory(school.admin, lesson.id, {
          scheduledAt: at(18).toISOString(),
        }),
      ]);
      const winner = await Promise.race([
        settled.then(() => 'settled'),
        delay(UNBLOCKED_WITHIN_MS).then(() => 'stuck'),
      ]);
      expect(winner).toBe('settled');

      const [closing, rescheduling] = await settled;
      expect(closing.status).toBe('fulfilled');
      if (rescheduling.status === 'rejected') {
        expect(rescheduling.reason).toBeInstanceOf(ConflictException);
      }
      // Either order ends with the future lesson cancelled by the closure.
      await expect(
        prisma.lesson.findUniqueOrThrow({ where: { id: lesson.id } }),
      ).resolves.toMatchObject({ status: LessonStatus.CANCELLED });
    });
  });

  describe('cancel', () => {
    it('keeps the row, its people and car, and records who cancelled it', async () => {
      const school = await createSchool();
      const lesson = await school.practice({ scheduledAt: at(10) });
      const countLessons = () =>
        prisma.drivingLesson.count({
          where: { organizationId: school.organization.id },
        });
      const before = await countLessons();

      await expect(
        lessonsService.cancelPractice(school.admin, lesson.id, {
          reason: 'Авто на ремонті',
        }),
      ).resolves.toMatchObject({
        status: LessonStatus.CANCELLED,
        cancellationReason: 'Авто на ремонті',
        car: { id: school.car1.id },
      });

      await expect(countLessons()).resolves.toBe(before);
      const row = await prisma.drivingLesson.findUniqueOrThrow({
        where: { id: lesson.id },
      });
      expect(row).toMatchObject({
        status: LessonStatus.CANCELLED,
        cancelledById: school.admin.id,
        cancellationReason: 'Авто на ремонті',
        instructorId: school.instructor.id,
        studentId: school.student1.id,
        carId: school.car1.id,
        scheduledAt: at(10),
      });
      expect(row.cancelledAt).toBeInstanceOf(Date);
    });

    it('frees the instructor, car and student for another lesson', async () => {
      const school = await createSchool();
      const cancelled = await school.practice({ scheduledAt: at(10) });
      const moving = await school.practice({ scheduledAt: at(13) });
      const moveTo10 = () =>
        lessonsService.reschedulePractice(school.admin, moving.id, {
          scheduledAt: at(10).toISOString(),
        });

      await expect(conflictsOf(moveTo10())).resolves.toEqual([
        'INSTRUCTOR/PRACTICE',
        'CAR/PRACTICE',
        'STUDENT/PRACTICE',
      ]);

      await lessonsService.cancelPractice(school.admin, cancelled.id, {});

      await expect(moveTo10()).resolves.toMatchObject({ scheduledAt: at(10) });
    });

    it('frees the group theory slot for practice of its student', async () => {
      const school = await createSchool();
      const theory = await school.theory(at(18));
      const moving = await school.practice({ scheduledAt: at(13) });
      const moveOntoTheory = () =>
        lessonsService.reschedulePractice(school.admin, moving.id, {
          scheduledAt: at(18, 30).toISOString(),
        });

      await expect(conflictsOf(moveOntoTheory())).resolves.toEqual([
        'STUDENT/THEORY',
      ]);

      await lessonsService.cancelTheory(school.teacher, theory.id, {
        reason: 'Викладач захворів',
      });

      await expect(moveOntoTheory()).resolves.toMatchObject({
        scheduledAt: at(18, 30),
      });
    });

    it('hides a cancelled lesson from the dashboards', async () => {
      const school = await createSchool();
      const kept = await school.practice({ scheduledAt: at(10) });
      const cancelled = await school.practice({
        carId: school.car2.id,
        studentId: school.student2.id,
        scheduledAt: at(13),
      });
      const theory = await school.theory(at(18));

      await lessonsService.cancelPractice(school.admin, cancelled.id, {});
      await lessonsService.cancelTheory(school.admin, theory.id, {});

      const instructor = await dashboardService.getInstructorDashboard(
        school.instructor,
      );
      expect(instructor.upcomingLessons.map((l) => l.id)).toEqual([kept.id]);
      expect(instructor.stats.studentsTotal).toBe(1);
      const teacher = await dashboardService.getTeacherDashboard(
        school.teacher,
      );
      expect(teacher.upcomingLessons).toEqual([]);
    });

    it('refuses a lesson of another school and leaves it untouched', async () => {
      const school = await createSchool();
      const other = await createSchool();
      const lesson = await other.practice({ scheduledAt: at(10) });

      await expect(
        lessonsService.cancelPractice(school.admin, lesson.id, {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        prisma.drivingLesson.findUniqueOrThrow({ where: { id: lesson.id } }),
      ).resolves.toMatchObject({
        status: LessonStatus.SCHEDULED,
        cancelledAt: null,
      });
    });

    it('makes a cancel wait for an in-flight reschedule of the same lesson', async () => {
      const school = await createSchool();
      const lesson = await school.practice({ scheduledAt: at(10) });
      const moved = deferred();
      const commit = deferred();

      // In-flight reschedule: holds the lesson row and has moved it to 14:00.
      const rescheduling = prisma.$transaction(async (tx) => {
        await lockPracticeLesson(tx, lesson.id, school.organization.id);
        await tx.drivingLesson.update({
          where: { id: lesson.id },
          data: { scheduledAt: at(14) },
        });
        moved.resolve();
        await commit.promise;
      });

      try {
        await moved.promise;
        const cancelling = lessonsService.cancelPractice(
          school.admin,
          lesson.id,
          {},
        );
        const state = track(cancelling);

        await delay(LOCK_WAIT_MS);
        expect(state.settled).toBe(false);

        commit.resolve();
        await rescheduling;

        await expect(cancelling).resolves.toMatchObject({
          status: LessonStatus.CANCELLED,
          scheduledAt: at(14),
        });
      } finally {
        commit.resolve();
        await rescheduling.catch(() => undefined);
      }
    });

    it('does not deadlock when a group closes while its lesson is cancelled', async () => {
      const school = await createSchool();
      const lesson = await school.theory(at(16));

      const settled = Promise.allSettled([
        groupsService.changeStatus(school.admin, school.group.id, {
          status: GroupStatus.COMPLETED,
        }),
        lessonsService.cancelTheory(school.teacher, lesson.id, {
          reason: 'Викладач захворів',
        }),
      ]);
      const winner = await Promise.race([
        settled.then(() => 'settled'),
        delay(UNBLOCKED_WITHIN_MS).then(() => 'stuck'),
      ]);
      expect(winner).toBe('settled');

      const [closing, cancelling] = await settled;
      expect(closing.status).toBe('fulfilled');
      const row = await prisma.lesson.findUniqueOrThrow({
        where: { id: lesson.id },
      });
      expect(row.status).toBe(LessonStatus.CANCELLED);
      expect(row.cancelledAt).toBeInstanceOf(Date);
      // Whoever came first owns the cancellation; the other sees it.
      if (cancelling.status === 'fulfilled') {
        expect(row).toMatchObject({
          cancelledById: school.teacher.id,
          cancellationReason: 'Викладач захворів',
        });
      } else {
        expect(cancelling.reason).toBeInstanceOf(ConflictException);
        expect(
          (cancelling.reason as ConflictException).getResponse(),
        ).toMatchObject({
          message: LESSON_NOT_CANCELLABLE_MESSAGE,
          currentStatus: LessonStatus.CANCELLED,
        });
        expect(row).toMatchObject({
          cancelledById: school.admin.id,
          cancellationReason: GROUP_CLOSED_CANCELLATION_REASON,
        });
      }
    });
  });
  describe('create', () => {
    type School = Awaited<ReturnType<typeof createSchool>>;

    const theoryAt = (school: School, scheduledAt: Date) =>
      lessonsService.createTheory(school.admin, {
        groupId: school.group.id,
        topic: 'Дорожні знаки',
        scheduledAt: scheduledAt.toISOString(),
      });

    const practiceAt = (school: School, studentId: string, scheduledAt: Date) =>
      lessonsService.createPractice(school.admin, {
        studentId,
        scheduledAt: scheduledAt.toISOString(),
        meetingPlace: 'Автодром',
      });

    it('stores a theory lesson of the group and shows it in the schedules', async () => {
      const school = await createSchool();

      const created = await lessonsService.createTheory(school.teacher, {
        groupId: school.group.id,
        topic: 'Дорожні знаки',
        scheduledAt: at(16).toISOString(),
      });

      await expect(
        prisma.lesson.findUniqueOrThrow({ where: { id: created.id } }),
      ).resolves.toMatchObject({
        groupId: school.group.id,
        topic: 'Дорожні знаки',
        scheduledAt: at(16),
        durationMin: 90,
        status: LessonStatus.SCHEDULED,
        cancelledAt: null,
      });
      for (const user of [school.teacher, school.student1, school.student2]) {
        const schedule = await scheduleService.getMySchedule(user, {});
        expect(schedule.items.map((item) => item.id)).toContain(created.id);
      }
    });

    it("stores a practice lesson with the student's instructor and car", async () => {
      const school = await createSchool();

      const created = await practiceAt(school, school.student1.id, at(10));

      await expect(
        prisma.drivingLesson.findUniqueOrThrow({ where: { id: created.id } }),
      ).resolves.toMatchObject({
        organizationId: school.organization.id,
        instructorId: school.instructor.id,
        studentId: school.student1.id,
        carId: school.car1.id,
        scheduledAt: at(10),
        // Без durationMin — 120 хвилин, як і бронювання студентом.
        durationMin: 120,
        status: LessonStatus.SCHEDULED,
        meetingPlace: 'Автодром',
      });
      expect(created.meetingPlace).toBe('Автодром');
      const dashboard = await dashboardService.getInstructorDashboard(
        school.instructor,
      );
      expect(dashboard.upcomingLessons).toEqual([
        expect.objectContaining({ id: created.id, meetingPlace: 'Автодром' }),
      ]);
    });

    it('changes only the meeting place while the car is in maintenance', async () => {
      const school = await createSchool();
      const created = await practiceAt(school, school.student1.id, at(10));
      await prisma.car.update({
        where: { id: school.car1.id },
        data: { status: CarStatus.MAINTENANCE },
      });

      const updated = await lessonsService.updatePractice(
        school.instructor,
        created.id,
        { meetingPlace: 'Біля офісу автошколи' },
      );

      expect(updated.meetingPlace).toBe('Біля офісу автошколи');
      await expect(
        prisma.drivingLesson.findUniqueOrThrow({ where: { id: created.id } }),
      ).resolves.toMatchObject({
        meetingPlace: 'Біля офісу автошколи',
        carId: school.car1.id,
        scheduledAt: at(10),
      });
    });

    it('refuses a slot taken by the instructor, the student or the group', async () => {
      const school = await createSchool();
      await school.practice({ scheduledAt: at(10) });
      await school.theory(at(16));

      // Той самий інструктор, інший студент і авто.
      await expect(
        conflictsOf(practiceAt(school, school.student2.id, at(10, 30))),
      ).resolves.toEqual(['INSTRUCTOR/PRACTICE']);
      // Теорія групи на час практики її студента.
      await expect(conflictsOf(theoryAt(school, at(10)))).resolves.toEqual([
        'STUDENT/PRACTICE',
      ]);
      // Практика студента на час теорії його групи.
      await expect(
        conflictsOf(practiceAt(school, school.student2.id, at(16, 30))),
      ).resolves.toEqual(['STUDENT/THEORY']);
      // Друга теорія групи поверх першої.
      await expect(conflictsOf(theoryAt(school, at(17)))).resolves.toEqual([
        'TEACHER/THEORY',
        'GROUP/THEORY',
      ]);
    });

    it('allows a lesson right after another one and over a cancelled one', async () => {
      const school = await createSchool();
      await school.practice({ scheduledAt: at(10) });
      await school.practice({
        scheduledAt: at(13),
        status: LessonStatus.CANCELLED,
        cancelledAt: new Date(),
      });

      // 10:00–11:00 вже є; нове заняття 11:00–13:00 (120 хв за замовчуванням).
      await expect(
        practiceAt(school, school.student1.id, at(11)),
      ).resolves.toMatchObject({ scheduledAt: at(11) });
      await expect(
        practiceAt(school, school.student1.id, at(13)),
      ).resolves.toMatchObject({ scheduledAt: at(13) });
    });

    it('refuses the same request twice and keeps one lesson', async () => {
      const school = await createSchool();

      await practiceAt(school, school.student1.id, at(10));

      await expect(
        conflictsOf(practiceAt(school, school.student1.id, at(10))),
      ).resolves.toEqual([
        'INSTRUCTOR/PRACTICE',
        'CAR/PRACTICE',
        'STUDENT/PRACTICE',
      ]);
      await expect(
        prisma.drivingLesson.count({
          where: { studentId: school.student1.id },
        }),
      ).resolves.toBe(1);
    });

    it('refuses a group, student, instructor or car of another school and writes nothing', async () => {
      const school = await createSchool();
      const other = await createSchool();
      const scheduledAt = at(10).toISOString();

      await expect(
        lessonsService.createTheory(school.admin, {
          groupId: other.group.id,
          topic: 'Дорожні знаки',
          scheduledAt,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        lessonsService.createPractice(school.admin, {
          studentId: other.student1.id,
          scheduledAt,
          meetingPlace: 'Автодром',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        lessonsService.createPractice(school.admin, {
          studentId: school.student1.id,
          instructorId: other.instructor.id,
          scheduledAt,
          meetingPlace: 'Автодром',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        lessonsService.createPractice(school.admin, {
          studentId: school.student1.id,
          carId: other.car1.id,
          scheduledAt,
          meetingPlace: 'Автодром',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      await expect(
        prisma.lesson.count({
          where: { groupId: { in: [school.group.id, other.group.id] } },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.drivingLesson.count({
          where: {
            organizationId: {
              in: [school.organization.id, other.organization.id],
            },
          },
        }),
      ).resolves.toBe(0);
    });

    it('makes a create wait for a booking of the same instructor and see it', async () => {
      const school = await createSchool();
      const booked = deferred();
      const commit = deferred();

      // In-flight booking: holds the instructor key and has inserted 10:00.
      const booking = prisma.$transaction(async (tx) => {
        await lockScheduleResources(tx, [
          scheduleLockKey('instructor', school.instructor.id),
        ]);
        await tx.drivingLesson.create({
          data: {
            organizationId: school.organization.id,
            instructorId: school.instructor.id,
            carId: school.car1.id,
            studentId: school.student1.id,
            scheduledAt: at(10),
          },
        });
        booked.resolve();
        await commit.promise;
      });

      try {
        await booked.promise;
        const creating = practiceAt(school, school.student2.id, at(10));
        const state = track(creating);

        await delay(LOCK_WAIT_MS);
        expect(state.settled).toBe(false);

        commit.resolve();
        await booking;

        await expect(conflictsOf(creating)).resolves.toEqual([
          'INSTRUCTOR/PRACTICE',
        ]);
        await expect(
          prisma.drivingLesson.count({
            where: { studentId: school.student2.id },
          }),
        ).resolves.toBe(0);
      } finally {
        commit.resolve();
        await booking.catch(() => undefined);
      }
    });

    it('lets only one of two parallel creates into the same slot win', async () => {
      const school = await createSchool();

      const results = await Promise.allSettled([
        practiceAt(school, school.student1.id, at(10)),
        practiceAt(school, school.student2.id, at(10)),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      const rejected = results.find((r) => r.status === 'rejected');
      expect(rejected?.reason).toBeInstanceOf(ConflictException);
      await expect(
        prisma.drivingLesson.count({
          where: { instructorId: school.instructor.id, scheduledAt: at(10) },
        }),
      ).resolves.toBe(1);
    });

    it('makes a theory create wait for the group to close and then refuse', async () => {
      const school = await createSchool();
      const closed = deferred();
      const commit = deferred();

      // In-flight changeStatus: holds FOR UPDATE and has saved COMPLETED.
      const closing = prisma.$transaction(async (tx) => {
        await lockGroup(tx, school.group.id, school.organization.id, 'update');
        await tx.group.update({
          where: { id: school.group.id },
          data: { status: GroupStatus.COMPLETED },
        });
        closed.resolve();
        await commit.promise;
      });

      try {
        await closed.promise;
        const creating = theoryAt(school, at(16));
        const state = track(creating);

        await delay(LOCK_WAIT_MS);
        expect(state.settled).toBe(false);

        commit.resolve();
        await closing;

        const error: unknown = await creating.catch(
          (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).message).toBe(
          LESSON_GROUP_NOT_OPEN_MESSAGE,
        );
        await expect(
          prisma.lesson.count({ where: { groupId: school.group.id } }),
        ).resolves.toBe(0);
      } finally {
        commit.resolve();
        await closing.catch(() => undefined);
      }
    });

    it('does not deadlock when a group closes while its lesson is created', async () => {
      const school = await createSchool();

      const settled = Promise.allSettled([
        groupsService.changeStatus(school.admin, school.group.id, {
          status: GroupStatus.COMPLETED,
        }),
        theoryAt(school, at(16)),
      ]);
      const winner = await Promise.race([
        settled.then(() => 'settled'),
        delay(UNBLOCKED_WITHIN_MS).then(() => 'stuck'),
      ]);
      expect(winner).toBe('settled');

      const [closing, creating] = await settled;
      expect(closing.status).toBe('fulfilled');
      if (creating.status === 'rejected') {
        expect(creating.reason).toBeInstanceOf(ConflictException);
      } else {
        // Створене раніше заняття скасувало закриття групи.
        await expect(
          prisma.lesson.findUniqueOrThrow({
            where: { id: creating.value.id },
          }),
        ).resolves.toMatchObject({ status: LessonStatus.CANCELLED });
      }
    });
  });

  describe('personal schedule', () => {
    type School = Awaited<ReturnType<typeof createSchool>>;

    const ids = (schedule: PersonalScheduleDto) =>
      schedule.items.map((item) => item.id);

    function fromNow(minutes: number): Date {
      return new Date(Date.now() + minutes * MINUTE_MS);
    }

    /** A theory lesson of a second group of the same school, with its own teacher. */
    async function otherGroupLesson(school: School, scheduledAt: Date) {
      const teacher = await prisma.user.create({
        data: {
          organizationId: school.organization.id,
          email: `other-teacher-${school.group.id}@lessons.example.com`,
          firstName: 'Other',
          lastName: 'TEACHER',
          role: UserRole.TEACHER,
        },
      });
      const group = await prisma.group.create({
        data: {
          name: `Інша група ${school.group.id}`,
          status: GroupStatus.ACTIVE,
          organizationId: school.organization.id,
          teacherId: teacher.id,
        },
      });
      return prisma.lesson.create({
        data: {
          organizationId: school.organization.id,
          groupId: group.id,
          topic: 'Інша група',
          scheduledAt,
        },
      });
    }

    it('gives a student the group theory and own practice only', async () => {
      const school = await createSchool();
      const own = await school.practice({ scheduledAt: at(10) });
      const theory = await school.theory(at(18));
      await school.practice({
        studentId: school.student2.id,
        carId: school.car2.id,
        scheduledAt: at(12),
      });
      await otherGroupLesson(school, at(16));

      const schedule = await scheduleService.getMySchedule(school.student1, {});

      expect(ids(schedule)).toEqual([own.id, theory.id]);
      expect(schedule.timezone).toBe('Europe/Kyiv');
    });

    it('gives a teacher the theory of own groups only', async () => {
      const school = await createSchool();
      const theory = await school.theory(at(18));
      await otherGroupLesson(school, at(16));
      await school.practice({ scheduledAt: at(10) });

      await expect(
        scheduleService.getMySchedule(school.teacher, {}).then(ids),
      ).resolves.toEqual([theory.id]);
    });

    it('gives an instructor own practice only', async () => {
      const school = await createSchool();
      const own = await school.practice({ scheduledAt: at(10) });
      await school.practice({
        instructorId: school.otherInstructor.id,
        carId: school.car3.id,
        studentId: school.student2.id,
        scheduledAt: at(10),
      });
      await school.theory(at(18));

      await expect(
        scheduleService.getMySchedule(school.instructor, {}).then(ids),
      ).resolves.toEqual([own.id]);
    });

    it('never shows lessons of another school, even through a broken enrollment', async () => {
      const school = await createSchool();
      const other = await createSchool();
      await other.theory(at(18));
      await other.practice({ scheduledAt: at(10) });
      // An enrollment into another school's group: services never create it,
      // the organization filter must still hold.
      await prisma.enrollment.create({
        data: {
          groupId: other.group.id,
          studentId: school.student1.id,
          status: EnrollmentStatus.ACTIVE,
        },
      });

      for (const user of [school.student1, school.teacher, school.instructor]) {
        await expect(
          scheduleService.getMySchedule(user, {}).then(ids),
        ).resolves.toEqual([]);
      }
    });

    it('keeps lessons overlapping [from, to) and drops those touching its edges', async () => {
      const school = await createSchool();
      await school.practice({ scheduledAt: at(9) }); // ends exactly at from
      const running = await school.practice({ scheduledAt: at(9, 30) });
      const inside = await school.practice({ scheduledAt: at(13) });
      await school.practice({ scheduledAt: at(14) }); // starts exactly at to

      await expect(
        scheduleService
          .getMySchedule(school.instructor, {
            from: at(10).toISOString(),
            to: at(14).toISOString(),
          })
          .then(ids),
      ).resolves.toEqual([running.id, inside.id]);
    });

    it('shows the lesson in progress by default', async () => {
      const school = await createSchool();
      const lesson = await school.practice({ scheduledAt: fromNow(-30) });

      const { items } = await scheduleService.getMySchedule(
        school.student1,
        {},
      );

      expect(items).toMatchObject([{ id: lesson.id, timing: 'IN_PROGRESS' }]);
    });

    it('returns finished lessons for a past window: SCHEDULED, but FINISHED', async () => {
      const school = await createSchool();
      const theory = await school.theory(fromNow(-2 * 24 * 60));

      const { items } = await scheduleService.getMySchedule(school.student1, {
        from: fromNow(-3 * 24 * 60).toISOString(),
        to: fromNow(-24 * 60).toISOString(),
      });

      expect(items).toMatchObject([
        {
          id: theory.id,
          status: LessonStatus.SCHEDULED,
          timing: 'FINISHED',
        },
      ]);
    });

    it('hides a cancelled lesson unless includeCancelled is set', async () => {
      const school = await createSchool();
      const lesson = await school.practice({ scheduledAt: at(10) });
      await lessonsService.cancelPractice(school.admin, lesson.id, {
        reason: 'Авто на ремонті',
      });

      await expect(
        scheduleService.getMySchedule(school.student1, {}).then(ids),
      ).resolves.toEqual([]);
      const { items } = await scheduleService.getMySchedule(school.student1, {
        includeCancelled: true,
      });
      expect(items).toMatchObject([
        {
          id: lesson.id,
          status: LessonStatus.CANCELLED,
          cancellationReason: 'Авто на ремонті',
        },
      ]);
      expect(items[0].cancelledAt).toBeInstanceOf(Date);
    });

    it('keeps the history of a closed group for its student, but not its cancelled future', async () => {
      const school = await createSchool();
      const past = await school.theory(fromNow(-2 * 24 * 60));
      const future = await school.theory(at(18));
      await groupsService.changeStatus(school.admin, school.group.id, {
        status: GroupStatus.COMPLETED,
      });
      const window = {
        from: fromNow(-3 * 24 * 60).toISOString(),
        to: fromNow(10 * 24 * 60).toISOString(),
        includeCancelled: true,
      };

      await expect(
        scheduleService.getMySchedule(school.student1, window).then(ids),
      ).resolves.toEqual([past.id]);
      await expect(
        scheduleService.getMySchedule(school.teacher, window).then(ids),
      ).resolves.toEqual([past.id, future.id]);
    });

    it('drops the group theory of a dropped student but keeps own practice', async () => {
      const school = await createSchool();
      await school.theory(fromNow(-2 * 24 * 60));
      await school.theory(at(18));
      const practice = await school.practice({ scheduledAt: at(10) });
      await prisma.enrollment.updateMany({
        where: { studentId: school.student1.id },
        data: { status: EnrollmentStatus.DROPPED },
      });

      await expect(
        scheduleService
          .getMySchedule(school.student1, {
            from: fromNow(-3 * 24 * 60).toISOString(),
            to: fromNow(10 * 24 * 60).toISOString(),
          })
          .then(ids),
      ).resolves.toEqual([practice.id]);
    });
  });

  describe('attendance', () => {
    /** Started ten minutes ago, so attendance can already be marked. */
    function startedAt(): Date {
      return new Date(Date.now() - 10 * MINUTE_MS);
    }

    function mark(studentId: string, status: AttendanceStatus) {
      return { records: [{ studentId, status }] };
    }

    // createSchool gives both students the same name, so look rows up by id.
    function studentIn(result: LessonAttendanceDto, studentId: string) {
      return result.students.find((student) => student.id === studentId);
    }

    async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
      return promise.then(
        () => {
          throw new Error('Expected the promise to reject');
        },
        (error: unknown) => error,
      );
    }

    it('allows only one row per lesson and student in the table', async () => {
      const school = await createSchool();
      const lesson = await school.theory(startedAt());
      const data = {
        lessonId: lesson.id,
        studentId: school.student1.id,
        status: AttendanceStatus.PRESENT,
        markedAt: new Date(),
      };
      await prisma.lessonAttendance.create({ data });

      await expect(
        prisma.lessonAttendance.create({
          data: { ...data, status: AttendanceStatus.ABSENT },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('updates the status in place and answers with what a later read sees', async () => {
      const school = await createSchool();
      const lesson = await school.theory(startedAt());

      await attendanceService.updateAttendance(
        school.teacher,
        lesson.id,
        mark(school.student1.id, AttendanceStatus.PRESENT),
      );
      const saved = await attendanceService.updateAttendance(
        school.teacher,
        lesson.id,
        mark(school.student1.id, AttendanceStatus.LATE),
      );

      const rows = await prisma.lessonAttendance.findMany({
        where: { lessonId: lesson.id },
      });
      expect(rows).toEqual([
        expect.objectContaining({
          studentId: school.student1.id,
          status: AttendanceStatus.LATE,
          markedById: school.teacher.id,
        }),
      ]);
      expect(studentIn(saved, school.student1.id)).toMatchObject({
        enrollmentStatus: EnrollmentStatus.ACTIVE,
        attendance: { status: AttendanceStatus.LATE },
      });
      expect(studentIn(saved, school.student2.id)).toMatchObject({
        attendance: null,
      });
      await expect(
        attendanceService.getAttendance(school.teacher, lesson.id),
      ).resolves.toEqual(saved);
    });

    it('keeps other schools out', async () => {
      const school = await createSchool();
      const other = await createSchool();
      const lesson = await school.theory(startedAt());
      const foreignLesson = await other.theory(startedAt());

      await expect(
        attendanceService.getAttendance(school.teacher, foreignLesson.id),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        attendanceService.updateAttendance(
          school.admin,
          foreignLesson.id,
          mark(other.student1.id, AttendanceStatus.PRESENT),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        attendanceService.updateAttendance(
          school.admin,
          lesson.id,
          mark(other.student1.id, AttendanceStatus.PRESENT),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        prisma.lessonAttendance.count({
          where: { lessonId: { in: [lesson.id, foreignLesson.id] } },
        }),
      ).resolves.toBe(0);
    });

    it('keeps the mark of a student removed from the group, read-only', async () => {
      const school = await createSchool();
      const lesson = await school.theory(startedAt());
      await attendanceService.updateAttendance(
        school.teacher,
        lesson.id,
        mark(school.student1.id, AttendanceStatus.ABSENT),
      );

      // Deletes the Enrollment row; the mark points at the user, so it stays.
      await groupsService.removeStudent(
        school.admin,
        school.group.id,
        school.student1.id,
      );

      const result = await attendanceService.getAttendance(
        school.teacher,
        lesson.id,
      );
      expect(studentIn(result, school.student1.id)).toMatchObject({
        enrollmentStatus: null,
        attendance: { status: AttendanceStatus.ABSENT },
      });
      await expect(
        attendanceService.updateAttendance(
          school.teacher,
          lesson.id,
          mark(school.student1.id, AttendanceStatus.PRESENT),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('shows the roster of a closed group but refuses changes', async () => {
      const school = await createSchool();
      const lesson = await school.theory(startedAt());

      await groupsService.changeStatus(school.admin, school.group.id, {
        status: GroupStatus.COMPLETED,
      });

      const result = await attendanceService.getAttendance(
        school.teacher,
        lesson.id,
      );
      expect(result.editable).toBe(false);
      // Closing cancels only future lessons; this one already started.
      expect(result.lesson.status).toBe(LessonStatus.SCHEDULED);
      expect(result.students.map((s) => s.enrollmentStatus)).toEqual([
        EnrollmentStatus.COMPLETED,
        EnrollmentStatus.COMPLETED,
      ]);
      const error = await rejectionOf(
        attendanceService.updateAttendance(
          school.teacher,
          lesson.id,
          mark(school.student1.id, AttendanceStatus.PRESENT),
        ),
      );
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe(
        ATTENDANCE_GROUP_CLOSED_MESSAGE,
      );
    });

    it('refuses to reschedule a lesson once attendance is marked', async () => {
      const school = await createSchool();
      const marked = await school.theory(startedAt());
      const unmarked = await school.theory(
        new Date(Date.now() - 5 * MINUTE_MS),
      );
      await attendanceService.updateAttendance(
        school.teacher,
        marked.id,
        mark(school.student1.id, AttendanceStatus.PRESENT),
      );
      const moveTo18 = (lessonId: string) =>
        lessonsService.rescheduleTheory(school.teacher, lessonId, {
          scheduledAt: at(18).toISOString(),
        });

      const error = await rejectionOf(moveTo18(marked.id));
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe(
        LESSON_HAS_ATTENDANCE_MESSAGE,
      );

      await expect(moveTo18(unmarked.id)).resolves.toMatchObject({
        scheduledAt: at(18),
      });
    });

    it('waits for an in-flight reschedule of the same lesson, then sees it in the future', async () => {
      const school = await createSchool();
      const lesson = await school.theory(startedAt());
      const moved = deferred();
      const commit = deferred();

      // In-flight reschedule: holds the lesson row and has moved it to 18:00.
      const rescheduling = prisma.$transaction(async (tx) => {
        await lockTheoryLesson(tx, lesson.id, school.organization.id);
        await tx.lesson.update({
          where: { id: lesson.id },
          data: { scheduledAt: at(18) },
        });
        moved.resolve();
        await commit.promise;
      });

      try {
        await moved.promise;
        const marking = attendanceService.updateAttendance(
          school.teacher,
          lesson.id,
          mark(school.student1.id, AttendanceStatus.PRESENT),
        );
        const state = track(marking);

        await delay(LOCK_WAIT_MS);
        expect(state.settled).toBe(false);

        commit.resolve();
        await rescheduling;

        const error = await rejectionOf(marking);
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).message).toBe(
          ATTENDANCE_NOT_STARTED_MESSAGE,
        );
        await expect(
          prisma.lessonAttendance.count({ where: { lessonId: lesson.id } }),
        ).resolves.toBe(0);
      } finally {
        commit.resolve();
        await rescheduling.catch(() => undefined);
      }
    });

    it('serializes two saves of the same lesson: one row, each answer shows its own write', async () => {
      const school = await createSchool();
      const lesson = await school.theory(startedAt());

      const [present, absent] = await Promise.all([
        attendanceService.updateAttendance(
          school.teacher,
          lesson.id,
          mark(school.student1.id, AttendanceStatus.PRESENT),
        ),
        attendanceService.updateAttendance(
          school.admin,
          lesson.id,
          mark(school.student1.id, AttendanceStatus.ABSENT),
        ),
      ]);

      expect(studentIn(present, school.student1.id)?.attendance?.status).toBe(
        AttendanceStatus.PRESENT,
      );
      expect(studentIn(absent, school.student1.id)?.attendance?.status).toBe(
        AttendanceStatus.ABSENT,
      );
      const rows = await prisma.lessonAttendance.findMany({
        where: { lessonId: lesson.id },
      });
      expect(rows).toHaveLength(1);
      expect([AttendanceStatus.PRESENT, AttendanceStatus.ABSENT]).toContain(
        rows[0].status,
      );
    });

    it('does not deadlock when the group closes while attendance is saved', async () => {
      const school = await createSchool();
      const lesson = await school.theory(startedAt());

      const settled = Promise.allSettled([
        groupsService.changeStatus(school.admin, school.group.id, {
          status: GroupStatus.COMPLETED,
        }),
        attendanceService.updateAttendance(
          school.teacher,
          lesson.id,
          mark(school.student1.id, AttendanceStatus.PRESENT),
        ),
      ]);
      const winner = await Promise.race([
        settled.then(() => 'settled'),
        delay(UNBLOCKED_WITHIN_MS).then(() => 'stuck'),
      ]);
      expect(winner).toBe('settled');

      const [closing, marking] = await settled;
      expect(closing.status).toBe('fulfilled');
      // Whoever came first wins: the mark is saved, or the closed group refuses it.
      if (marking.status === 'rejected') {
        expect(marking.reason).toBeInstanceOf(ConflictException);
        expect((marking.reason as ConflictException).message).toBe(
          ATTENDANCE_GROUP_CLOSED_MESSAGE,
        );
      }
      await expect(
        prisma.lessonAttendance.count({ where: { lessonId: lesson.id } }),
      ).resolves.toBe(marking.status === 'fulfilled' ? 1 : 0);
    });
  });

  describe('instructor schedule', () => {
    type School = Awaited<ReturnType<typeof createSchool>>;

    /** Місцева дата at(10) в поясі автошколи (за замовчуванням Europe/Kyiv). */
    const localDay = () => localDate(at(10), 'Europe/Kyiv');

    const practiceAt = (school: School, scheduledAt: Date) =>
      lessonsService.createPractice(school.admin, {
        studentId: school.student1.id,
        scheduledAt: scheduledAt.toISOString(),
        meetingPlace: 'Автодром',
      });

    const wholeDayOff = (school: School) =>
      instructorScheduleService.createTimeOff(
        school.admin,
        school.instructor.id,
        { type: TimeOffType.SICK_LEAVE, startDate: localDay() },
      );

    describe('migration', () => {
      it('rejects working hours outside one day or with end before start', async () => {
        const school = await createSchool();
        const hours = (startMinute: number, endMinute: number) =>
          prisma.instructorWorkingHours.create({
            data: {
              organizationId: school.organization.id,
              instructorId: school.instructor.id,
              dayOfWeek: DayOfWeek.MONDAY,
              startMinute,
              endMinute,
            },
          });

        await expect(hours(600, 540)).rejects.toThrow();
        await expect(hours(540, 540)).rejects.toThrow();
        await expect(hours(-1, 540)).rejects.toThrow();
        await expect(hours(1380, 1441)).rejects.toThrow();
        await expect(hours(0, 1440)).resolves.toMatchObject({
          endMinute: 1440,
        });
      });

      it('rejects time off that ends before it starts', async () => {
        const school = await createSchool();

        await expect(
          prisma.instructorTimeOff.create({
            data: {
              organizationId: school.organization.id,
              instructorId: school.instructor.id,
              startsAt: at(12),
              endsAt: at(12),
            },
          }),
        ).rejects.toThrow();
      });

      it('ties working hours and time off to an instructor of the same school', async () => {
        const school = await createSchool();
        const other = await createSchool();

        await expect(
          prisma.instructorWorkingHours.create({
            data: {
              organizationId: school.organization.id,
              instructorId: other.instructor.id,
              dayOfWeek: DayOfWeek.MONDAY,
              startMinute: 540,
              endMinute: 1080,
            },
          }),
        ).rejects.toThrow();
        await expect(
          prisma.instructorTimeOff.create({
            data: {
              organizationId: school.organization.id,
              instructorId: other.instructor.id,
              startsAt: at(10),
              endsAt: at(12),
            },
          }),
        ).rejects.toThrow();
      });

      it('removes the schedule together with the instructor', async () => {
        const school = await createSchool();
        await instructorScheduleService.replaceWorkingHours(
          school.admin,
          school.otherInstructor.id,
          {
            intervals: [
              { dayOfWeek: DayOfWeek.MONDAY, start: '09:00', end: '18:00' },
            ],
          },
        );
        await instructorScheduleService.createTimeOff(
          school.admin,
          school.otherInstructor.id,
          { startDate: localDay() },
        );
        await prisma.car.delete({ where: { id: school.car3.id } });

        await prisma.user.delete({ where: { id: school.otherInstructor.id } });

        await expect(
          prisma.instructorWorkingHours.count({
            where: { instructorId: school.otherInstructor.id },
          }),
        ).resolves.toBe(0);
        await expect(
          prisma.instructorTimeOff.count({
            where: { instructorId: school.otherInstructor.id },
          }),
        ).resolves.toBe(0);
      });
    });

    it('replaces the week as a whole and reads it back in weekday order', async () => {
      const school = await createSchool();
      const replace = (
        intervals: { dayOfWeek: DayOfWeek; start: string; end: string }[],
      ) =>
        instructorScheduleService.replaceWorkingHours(
          school.admin,
          school.instructor.id,
          { intervals },
        );

      await replace([
        { dayOfWeek: DayOfWeek.FRIDAY, start: '10:00', end: '16:00' },
        { dayOfWeek: DayOfWeek.MONDAY, start: '14:00', end: '18:00' },
        { dayOfWeek: DayOfWeek.MONDAY, start: '09:00', end: '13:00' },
      ]);
      await replace([
        { dayOfWeek: DayOfWeek.TUESDAY, start: '09:00', end: '24:00' },
        { dayOfWeek: DayOfWeek.MONDAY, start: '08:00', end: '12:00' },
      ]);

      await expect(
        instructorScheduleService.getWorkingHours(
          school.instructor,
          school.instructor.id,
        ),
      ).resolves.toEqual({
        instructorId: school.instructor.id,
        timezone: 'Europe/Kyiv',
        intervals: [
          { dayOfWeek: DayOfWeek.MONDAY, start: '08:00', end: '12:00' },
          { dayOfWeek: DayOfWeek.TUESDAY, start: '09:00', end: '24:00' },
        ],
      });
    });

    it('refuses time off over a SCHEDULED lesson and ignores a cancelled one', async () => {
      const school = await createSchool();
      await school.practice({
        scheduledAt: at(8),
        status: LessonStatus.CANCELLED,
        cancelledAt: new Date(),
      });
      const lesson = await school.practice({ scheduledAt: at(10) });

      const error: unknown = await wholeDayOff(school).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(ConflictException);
      const body = (error as ConflictException).getResponse() as {
        conflicts: LessonConflict[];
      };
      expect(body.conflicts.map((c) => [c.lessonType, c.lessonId])).toEqual([
        ['PRACTICE', lesson.id],
      ]);
      await expect(
        prisma.instructorTimeOff.count({
          where: { instructorId: school.instructor.id },
        }),
      ).resolves.toBe(0);

      await lessonsService.cancelPractice(school.admin, lesson.id, {});
      await expect(wholeDayOff(school)).resolves.toMatchObject({
        type: TimeOffType.SICK_LEAVE,
      });
    });

    it('refuses a lesson during time off of the instructor, but not right after it', async () => {
      const school = await createSchool();
      await instructorScheduleService.createTimeOff(
        school.admin,
        school.instructor.id,
        {
          startsAt: at(9).toISOString(),
          endsAt: at(11).toISOString(),
        },
      );

      await expect(
        conflictsOf(practiceAt(school, at(10, 30))),
      ).resolves.toEqual(['INSTRUCTOR/TIME_OFF']);
      await expect(practiceAt(school, at(11))).resolves.toMatchObject({
        status: LessonStatus.SCHEDULED,
      });
    });

    it('makes time off wait for a lesson booking of the same instructor and see it', async () => {
      const school = await createSchool();
      const booked = deferred();
      const commit = deferred();

      // In-flight lesson booking: holds the instructor key and has inserted 10:00.
      const booking = prisma.$transaction(async (tx) => {
        await lockScheduleResources(tx, [
          scheduleLockKey('instructor', school.instructor.id),
        ]);
        await tx.drivingLesson.create({
          data: {
            organizationId: school.organization.id,
            instructorId: school.instructor.id,
            carId: school.car1.id,
            studentId: school.student1.id,
            scheduledAt: at(10),
          },
        });
        booked.resolve();
        await commit.promise;
      });

      try {
        await booked.promise;
        const creating = wholeDayOff(school);
        const state = track(creating);

        await delay(LOCK_WAIT_MS);
        expect(state.settled).toBe(false);

        commit.resolve();
        await booking;

        await expect(conflictsOf(creating)).resolves.toEqual([
          'INSTRUCTOR/PRACTICE',
        ]);
        await expect(
          prisma.instructorTimeOff.count({
            where: { instructorId: school.instructor.id },
          }),
        ).resolves.toBe(0);
      } finally {
        commit.resolve();
        await booking.catch(() => undefined);
      }
    });

    it('makes a lesson booking wait for time off of the same instructor and see it', async () => {
      const school = await createSchool();
      const inserted = deferred();
      const commit = deferred();

      // In-flight time off: holds the instructor key and has inserted the whole day.
      const timeOff = prisma.$transaction(async (tx) => {
        await lockScheduleResources(tx, [
          scheduleLockKey('instructor', school.instructor.id),
        ]);
        await tx.instructorTimeOff.create({
          data: {
            organizationId: school.organization.id,
            instructorId: school.instructor.id,
            startsAt: at(0),
            endsAt: at(24),
          },
        });
        inserted.resolve();
        await commit.promise;
      });

      try {
        await inserted.promise;
        const creating = practiceAt(school, at(10));
        const state = track(creating);

        await delay(LOCK_WAIT_MS);
        expect(state.settled).toBe(false);

        commit.resolve();
        await timeOff;

        await expect(conflictsOf(creating)).resolves.toEqual([
          'INSTRUCTOR/TIME_OFF',
        ]);
        await expect(
          prisma.drivingLesson.count({
            where: { instructorId: school.instructor.id },
          }),
        ).resolves.toBe(0);
      } finally {
        commit.resolve();
        await timeOff.catch(() => undefined);
      }
    });
  });

  describe('practice booking', () => {
    type School = Awaited<ReturnType<typeof createSchool>>;

    /** День тижня DAY: у цих тестах пояс автошколи — UTC, тож at(h) = h:00. */
    const DAY_OF_WEEK = [
      DayOfWeek.SUNDAY,
      DayOfWeek.MONDAY,
      DayOfWeek.TUESDAY,
      DayOfWeek.WEDNESDAY,
      DayOfWeek.THURSDAY,
      DayOfWeek.FRIDAY,
      DayOfWeek.SATURDAY,
    ][DAY.getUTCDay()];

    const day = () => ({ from: at(0).toISOString(), to: at(24).toISOString() });

    /** Інструктор працює 09:00–13:00 і 14:00–18:00: слоти 9, 11, 14, 16. */
    async function openSchool(): Promise<School> {
      const school = await createSchool();
      await prisma.organization.update({
        where: { id: school.organization.id },
        data: { timezone: 'UTC' },
      });
      await instructorScheduleService.replaceWorkingHours(
        school.admin,
        school.instructor.id,
        {
          intervals: [
            { dayOfWeek: DAY_OF_WEEK, start: '09:00', end: '13:00' },
            { dayOfWeek: DAY_OF_WEEK, start: '14:00', end: '18:00' },
          ],
        },
      );
      return school;
    }

    const freeHours = async (student: User) =>
      (await practiceLessonsService.listAvailable(student, day())).items.map(
        (item) => item.scheduledAt.getUTCHours(),
      );

    const bookAt = (student: User, hour: number) =>
      practiceLessonsService.book(student, {
        scheduledAt: at(hour).toISOString(),
      });

    it('computes the free hours from the working week of the student instructor only', async () => {
      const school = await openSchool();
      const other = await createSchool();
      await instructorScheduleService.replaceWorkingHours(
        school.admin,
        school.otherInstructor.id,
        {
          intervals: [{ dayOfWeek: DAY_OF_WEEK, start: '06:00', end: '08:00' }],
        },
      );

      await expect(freeHours(school.student1)).resolves.toEqual([
        9, 11, 14, 16,
      ]);
      // Інша автошкола без графіка — порожньо, і чужі слоти не просочуються.
      await expect(freeHours(other.student1)).resolves.toEqual([]);
    });

    it('hides hours taken by time off, the instructor, and theory of the student group', async () => {
      const school = await openSchool();
      await instructorScheduleService.createTimeOff(
        school.admin,
        school.instructor.id,
        { startsAt: at(16).toISOString(), endsAt: at(18).toISOString() },
      );
      // Той самий інструктор з іншим студентом і авто о 11:00.
      const lesson = await lessonsService.createPractice(school.admin, {
        studentId: school.student2.id,
        scheduledAt: at(11).toISOString(),
        durationMin: 120,
        meetingPlace: 'Автодром',
      });
      // Теорія групи студента 09:30–11:00.
      await school.theory(at(9, 30), 90);

      await expect(freeHours(school.student1)).resolves.toEqual([14]);

      await lessonsService.cancelPractice(school.admin, lesson.id, {});
      await expect(freeHours(school.student1)).resolves.toEqual([11, 14]);
    });

    it('offers nothing while the car is in maintenance or the instructor is blocked', async () => {
      const school = await openSchool();

      await prisma.car.update({
        where: { id: school.car1.id },
        data: { status: CarStatus.MAINTENANCE },
      });
      await expect(freeHours(school.student1)).resolves.toEqual([]);

      await prisma.car.update({
        where: { id: school.car1.id },
        data: { status: CarStatus.AVAILABLE },
      });
      await prisma.user.update({
        where: { id: school.instructor.id },
        data: { status: UserStatus.BLOCKED },
      });
      await expect(freeHours(school.student1)).resolves.toEqual([]);
    });

    it('books a 120-minute lesson that then blocks the hour for others', async () => {
      const school = await openSchool();

      const booked = await bookAt(school.student1, 9);

      expect(booked).toMatchObject({
        status: LessonStatus.SCHEDULED,
        bookingStatus: 'PENDING',
        confirmationStatus: BookingConfirmation.PENDING,
        confirmedAt: null,
        paymentStatus: PaymentStatus.PAID,
        durationMin: 120,
        scheduledAt: at(9),
        endsAt: at(11),
        meetingPlace: null,
      });
      expect(booked.instructor.id).toBe(school.instructor.id);
      expect(booked.student.id).toBe(school.student1.id);
      expect(booked.car?.id).toBe(school.car1.id);
      await expect(conflictsOf(bookAt(school.student2, 9))).resolves.toEqual([
        'INSTRUCTOR/PRACTICE',
      ]);
      await expect(freeHours(school.student2)).resolves.toEqual([11, 14, 16]);
    });

    it('lets a student hold one lesson at a time and book again after cancelling it', async () => {
      const school = await openSchool();
      const first = await bookAt(school.student1, 9);

      await expect(bookAt(school.student1, 14)).rejects.toThrow(
        STUDENT_HAS_ACTIVE_LESSON_MESSAGE,
      );
      const listed = await practiceLessonsService.listAvailable(
        school.student1,
        day(),
      );
      expect(listed.activeLesson).toMatchObject({ id: first.id });

      // DAY — через тиждень, тож студент встигає скасувати за 24 години.
      await lessonsService.cancelPractice(school.student1, first.id, {});
      await expect(bookAt(school.student1, 14)).resolves.toMatchObject({
        scheduledAt: at(14),
      });
    });

    it('refuses a time off the grid, in the break or outside the working hours', async () => {
      const school = await openSchool();

      for (const hour of [10, 13, 17, 19]) {
        await expect(bookAt(school.student1, hour)).rejects.toThrow(
          SLOT_NOT_OPEN_MESSAGE,
        );
      }
      await expect(
        prisma.drivingLesson.count({
          where: { studentId: school.student1.id },
        }),
      ).resolves.toBe(0);
    });

    it('lets only one of two students booking the same hour at once win', async () => {
      const school = await openSchool();

      const results = await Promise.allSettled([
        bookAt(school.student1, 9),
        bookAt(school.student2, 9),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const [rejected] = results.filter((r) => r.status === 'rejected');
      expect(rejected.reason).toBeInstanceOf(ConflictException);
      await expect(
        prisma.drivingLesson.count({
          where: { instructorId: school.instructor.id, scheduledAt: at(9) },
        }),
      ).resolves.toBe(1);
    });

    it('lets only one of two parallel bookings of the same student win', async () => {
      const school = await openSchool();

      const results = await Promise.allSettled([
        bookAt(school.student1, 9),
        bookAt(school.student1, 14),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      await expect(
        prisma.drivingLesson.count({
          where: { studentId: school.student1.id },
        }),
      ).resolves.toBe(1);
    });

    it('makes a booking wait for time off of the same instructor and see it', async () => {
      const school = await openSchool();
      const inserted = deferred();
      const commit = deferred();

      // In-flight time off: holds the instructor key and has inserted the whole day.
      const timeOff = prisma.$transaction(async (tx) => {
        await lockScheduleResources(tx, [
          scheduleLockKey('instructor', school.instructor.id),
        ]);
        await tx.instructorTimeOff.create({
          data: {
            organizationId: school.organization.id,
            instructorId: school.instructor.id,
            startsAt: at(0),
            endsAt: at(24),
          },
        });
        inserted.resolve();
        await commit.promise;
      });

      try {
        await inserted.promise;
        const booking = bookAt(school.student1, 9);
        const state = track(booking);

        await delay(LOCK_WAIT_MS);
        expect(state.settled).toBe(false);

        commit.resolve();
        await timeOff;

        await expect(conflictsOf(booking)).resolves.toEqual([
          'INSTRUCTOR/TIME_OFF',
        ]);
      } finally {
        commit.resolve();
        await timeOff.catch(() => undefined);
      }
    });

    it('lists lessons of the school for ADMIN with filters, hiding cancelled ones by default', async () => {
      const school = await openSchool();
      const other = await openSchool();
      const booked = await bookAt(school.student1, 9);
      const byAdmin = await lessonsService.createPractice(school.admin, {
        studentId: school.student2.id,
        scheduledAt: at(14).toISOString(),
        meetingPlace: 'Автодром',
      });
      await bookAt(other.student1, 9);
      await lessonsService.cancelPractice(school.admin, byAdmin.id, {});

      const ids = async (query: object) =>
        (
          await practiceLessonsService.list(school.admin, {
            ...day(),
            ...query,
          })
        ).items.map((item) => item.id);

      await expect(ids({})).resolves.toEqual([booked.id]);
      await expect(ids({ includeCancelled: true })).resolves.toEqual([
        booked.id,
        byAdmin.id,
      ]);
      await expect(
        ids({ includeCancelled: true, studentId: school.student2.id }),
      ).resolves.toEqual([byAdmin.id]);
      await expect(
        ids({ instructorId: school.otherInstructor.id }),
      ).resolves.toEqual([]);
    });

    it('grants practice only after THEORY_COMPLETED, which frees the student from group theory', async () => {
      const school = await openSchool();
      // Студент 2 ще вчить теорію: ACTIVE, без інструктора й авто.
      await prisma.student.update({
        where: { userId: school.student2.id },
        data: {
          trainingStatus: TrainingStatus.ACTIVE,
          instructorId: null,
          carId: null,
        },
      });
      // Теорія групи 09:30–11:00 заходить у слот 09:00.
      await school.theory(at(9, 30), 90);
      const access = {
        instructorId: school.instructor.id,
        carId: school.car2.id,
      };

      await expect(
        studentsService.grantPracticeAccess(
          school.admin,
          school.student2.id,
          access,
        ),
      ).rejects.toThrow(STUDENT_PRACTICE_ACCESS_MESSAGE);

      await studentsService.changeTrainingStatus(
        school.admin,
        school.student2.id,
        { status: TrainingStatus.THEORY_COMPLETED },
      );
      await expect(
        prisma.enrollment.findFirstOrThrow({
          where: { studentId: school.student2.id, groupId: school.group.id },
        }),
      ).resolves.toMatchObject({ status: EnrollmentStatus.COMPLETED });

      await expect(
        studentsService.grantPracticeAccess(
          school.admin,
          school.student2.id,
          access,
        ),
      ).resolves.toMatchObject({
        student: { trainingStatus: TrainingStatus.PRACTICE },
      });

      // Група студента 1 ще активна: теорія блокує йому 09:00, а студенту 2 — ні.
      await expect(freeHours(school.student1)).resolves.toEqual([11, 14, 16]);
      await expect(freeHours(school.student2)).resolves.toEqual([
        9, 11, 14, 16,
      ]);
    });
  });

  describe('booking approval', () => {
    type School = Awaited<ReturnType<typeof createSchool>>;

    const DAY_OF_WEEK = [
      DayOfWeek.SUNDAY,
      DayOfWeek.MONDAY,
      DayOfWeek.TUESDAY,
      DayOfWeek.WEDNESDAY,
      DayOfWeek.THURSDAY,
      DayOfWeek.FRIDAY,
      DayOfWeek.SATURDAY,
    ][DAY.getUTCDay()];

    /** Як у 'practice booking': пояс UTC, слоти 9, 11, 14, 16. */
    async function openSchool(): Promise<School> {
      const school = await createSchool();
      await prisma.organization.update({
        where: { id: school.organization.id },
        data: { timezone: 'UTC' },
      });
      await instructorScheduleService.replaceWorkingHours(
        school.admin,
        school.instructor.id,
        {
          intervals: [
            { dayOfWeek: DAY_OF_WEEK, start: '09:00', end: '13:00' },
            { dayOfWeek: DAY_OF_WEEK, start: '14:00', end: '18:00' },
          ],
        },
      );
      return school;
    }

    const bookAt = (student: User, hour: number) =>
      practiceLessonsService.book(student, {
        scheduledAt: at(hour).toISOString(),
      });

    /** Запит, що чекає підтвердження, напряму в БД — для часу поза сіткою графіка. */
    const pendingAt = (school: School, scheduledAt: Date) =>
      prisma.drivingLesson.create({
        data: {
          organizationId: school.organization.id,
          instructorId: school.instructor.id,
          studentId: school.student1.id,
          carId: school.car1.id,
          scheduledAt,
          confirmationStatus: BookingConfirmation.PENDING,
        },
      });

    const row = (id: string) =>
      prisma.drivingLesson.findUniqueOrThrow({ where: { id } });

    describe('migration', () => {
      it('keeps the confirmation consistent with the lesson status', async () => {
        const school = await createSchool();
        const lesson = (data: object) =>
          prisma.drivingLesson.create({
            data: {
              organizationId: school.organization.id,
              instructorId: school.instructor.id,
              studentId: school.student1.id,
              carId: school.car1.id,
              scheduledAt: at(10),
              ...data,
            },
          });

        await expect(
          lesson({ confirmationStatus: BookingConfirmation.REJECTED }),
        ).rejects.toThrow();
        await expect(
          lesson({
            confirmationStatus: BookingConfirmation.PENDING,
            status: LessonStatus.COMPLETED,
          }),
        ).rejects.toThrow();
        await expect(
          lesson({
            confirmationStatus: BookingConfirmation.PENDING,
            confirmedAt: new Date(),
          }),
        ).rejects.toThrow();
        // Значення за замовчуванням: CONFIRMED і PAID.
        await expect(lesson({})).resolves.toMatchObject({
          confirmationStatus: BookingConfirmation.CONFIRMED,
          paymentStatus: PaymentStatus.PAID,
        });
      });
    });

    it('lets the instructor confirm a pending request', async () => {
      const school = await openSchool();
      const booked = await bookAt(school.student1, 9);

      const confirmed = await workflowService.confirm(
        school.instructor,
        booked.id,
      );

      expect(confirmed.bookingStatus).toBe('CONFIRMED');
      await expect(row(booked.id)).resolves.toMatchObject({
        status: LessonStatus.SCHEDULED,
        confirmationStatus: BookingConfirmation.CONFIRMED,
        confirmedById: school.instructor.id,
      });
      await expect(
        workflowService.confirm(school.admin, booked.id),
      ).rejects.toThrow(BOOKING_NOT_PENDING_MESSAGE);
    });

    it('frees the hour when the request is rejected', async () => {
      const school = await openSchool();
      const booked = await bookAt(school.student1, 9);

      const rejected = await workflowService.reject(school.admin, booked.id, {
        reason: 'Інструктор на навчанні',
      });

      expect(rejected).toMatchObject({
        bookingStatus: 'REJECTED',
        cancellationReason: 'Інструктор на навчанні',
      });
      await expect(bookAt(school.student2, 9)).resolves.toMatchObject({
        bookingStatus: 'PENDING',
      });
    });

    it('shows the instructor their pending requests and nothing of others', async () => {
      const school = await openSchool();
      const pending = await bookAt(school.student1, 9);
      const confirmed = await bookAt(school.student2, 14);
      await workflowService.confirm(school.admin, confirmed.id);

      const inbox = await practiceLessonsService.list(school.instructor, {
        from: at(0).toISOString(),
        to: at(24).toISOString(),
        confirmationStatus: BookingConfirmation.PENDING,
      });

      expect(inbox.items.map((item) => item.id)).toEqual([pending.id]);
      await expect(
        practiceLessonsService.list(school.otherInstructor, {
          from: at(0).toISOString(),
          to: at(24).toISOString(),
        }),
      ).resolves.toMatchObject({ items: [] });
    });

    it('rejects only requests left unanswered until 2 hours before the start', async () => {
      const school = await createSchool();
      const soon = await pendingAt(
        school,
        new Date(Date.now() + 90 * MINUTE_MS),
      );
      const later = await pendingAt(
        school,
        new Date(Date.now() + 5 * 60 * MINUTE_MS),
      );

      await expect(expiryJob.expireOverdue()).resolves.toBeGreaterThanOrEqual(
        1,
      );

      await expect(row(soon.id)).resolves.toMatchObject({
        status: LessonStatus.CANCELLED,
        confirmationStatus: BookingConfirmation.REJECTED,
        cancellationReason: BOOKING_EXPIRED_REASON,
        cancelledById: null,
      });
      await expect(row(later.id)).resolves.toMatchObject({
        status: LessonStatus.SCHEDULED,
        confirmationStatus: BookingConfirmation.PENDING,
      });
    });

    it('lets an in-flight confirmation win over the expiry job', async () => {
      const school = await createSchool();
      const lesson = await pendingAt(
        school,
        new Date(Date.now() + 90 * MINUTE_MS),
      );
      const updated = deferred();
      const commit = deferred();

      // In-flight confirmation: holds the row lock and has written CONFIRMED.
      const confirming = prisma.$transaction(async (tx) => {
        await lockPracticeLesson(tx, lesson.id, school.organization.id);
        await tx.drivingLesson.update({
          where: { id: lesson.id },
          data: {
            confirmationStatus: BookingConfirmation.CONFIRMED,
            confirmedAt: new Date(),
          },
        });
        updated.resolve();
        await commit.promise;
      });

      try {
        await updated.promise;
        const expiring = expiryJob.expireOverdue();
        const state = track(expiring);

        await delay(LOCK_WAIT_MS);
        expect(state.settled).toBe(false);

        commit.resolve();
        await confirming;
        await expiring;

        await expect(row(lesson.id)).resolves.toMatchObject({
          status: LessonStatus.SCHEDULED,
          confirmationStatus: BookingConfirmation.CONFIRMED,
        });
      } finally {
        commit.resolve();
        await confirming.catch(() => undefined);
      }
    });

    it('refuses to confirm a request the expiry job already rejected', async () => {
      const school = await createSchool();
      const lesson = await pendingAt(
        school,
        new Date(Date.now() + 90 * MINUTE_MS),
      );
      await expiryJob.expireOverdue();

      const error: unknown = await workflowService
        .confirm(school.admin, lesson.id)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        currentStatus: 'REJECTED',
      });
    });
  });

  describe('lesson outcomes', () => {
    type School = Awaited<ReturnType<typeof createSchool>>;

    /** Підтверджене заняття студента 1, що почалося годину тому. */
    const startedLesson = (school: School, studentId = school.student1.id) =>
      prisma.drivingLesson.create({
        data: {
          organizationId: school.organization.id,
          instructorId: school.instructor.id,
          studentId,
          carId: school.car1.id,
          scheduledAt: new Date(Date.now() - 60 * MINUTE_MS),
          durationMin: 120,
          confirmationStatus: BookingConfirmation.CONFIRMED,
          confirmedAt: new Date(),
        },
      });

    const row = (id: string) =>
      prisma.drivingLesson.findUniqueOrThrow({ where: { id } });

    describe('migration', () => {
      it('keeps NO_SHOW out of theory and ties the outcome to its status', async () => {
        const school = await createSchool();
        const practice = (data: object) =>
          prisma.drivingLesson.create({
            data: {
              organizationId: school.organization.id,
              instructorId: school.instructor.id,
              studentId: school.student1.id,
              carId: school.car1.id,
              scheduledAt: at(10),
              ...data,
            },
          });

        await expect(
          prisma.lesson.create({
            data: {
              organizationId: school.organization.id,
              groupId: school.group.id,
              topic: 'Знаки',
              scheduledAt: at(10),
              status: LessonStatus.NO_SHOW,
            },
          }),
        ).rejects.toThrow();
        // Результат без моменту, момент без результату, результат без підтвердження.
        await expect(
          practice({ status: LessonStatus.COMPLETED }),
        ).rejects.toThrow();
        await expect(practice({ outcomeAt: new Date() })).rejects.toThrow();
        await expect(
          practice({
            status: LessonStatus.NO_SHOW,
            outcomeAt: new Date(),
            confirmationStatus: BookingConfirmation.PENDING,
          }),
        ).rejects.toThrow();
        await expect(
          practice({ status: LessonStatus.NO_SHOW, outcomeAt: new Date() }),
        ).resolves.toMatchObject({ status: LessonStatus.NO_SHOW });
      });
    });

    it('lets the instructor confirm the lesson took place, with a comment the student sees', async () => {
      const school = await createSchool();
      const lesson = await startedLesson(school);

      const result = await workflowService.recordOutcome(
        school.instructor,
        lesson.id,
        { result: LessonStatus.COMPLETED, comment: 'Впевнено паркується' },
      );

      expect(result).toMatchObject({
        bookingStatus: 'COMPLETED',
        instructorComment: 'Впевнено паркується',
      });
      await expect(row(lesson.id)).resolves.toMatchObject({
        status: LessonStatus.COMPLETED,
        outcomeById: school.instructor.id,
      });
      const schedule = await scheduleService.getMySchedule(school.student1, {
        from: new Date(Date.now() - 3 * 60 * MINUTE_MS).toISOString(),
        type: 'PRACTICE',
      });
      expect(schedule.items).toEqual([
        expect.objectContaining({
          id: lesson.id,
          bookingStatus: 'COMPLETED',
          instructorComment: 'Впевнено паркується',
        }),
      ]);
    });

    it('records a no-show once and refuses a second result', async () => {
      const school = await createSchool();
      const lesson = await startedLesson(school);

      await workflowService.recordOutcome(school.admin, lesson.id, {
        result: LessonStatus.NO_SHOW,
      });

      await expect(
        workflowService.recordOutcome(school.instructor, lesson.id, {
          result: LessonStatus.COMPLETED,
        }),
      ).rejects.toThrow(ConflictException);
      await expect(row(lesson.id)).resolves.toMatchObject({
        status: LessonStatus.NO_SHOW,
        outcomeById: school.admin.id,
      });
    });

    it('refuses a result for a lesson that has not started and for a cancelled one', async () => {
      const school = await createSchool();
      const future = await school.practice({ scheduledAt: at(10) });
      const cancelled = await startedLesson(school, school.student2.id);
      await prisma.drivingLesson.update({
        where: { id: cancelled.id },
        data: { status: LessonStatus.CANCELLED, cancelledAt: new Date() },
      });

      await expect(
        workflowService.recordOutcome(school.admin, future.id, {
          result: LessonStatus.COMPLETED,
        }),
      ).rejects.toThrow(ConflictException);
      await expect(
        workflowService.recordOutcome(school.admin, cancelled.id, {
          result: LessonStatus.COMPLETED,
        }),
      ).rejects.toThrow(ConflictException);
      await expect(
        workflowService.updateComment(school.admin, cancelled.id, {
          comment: 'x',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('counts the practice progress of a student', async () => {
      const school = await createSchool();
      const done = await startedLesson(school);
      await workflowService.recordOutcome(school.instructor, done.id, {
        result: LessonStatus.COMPLETED,
      });
      const missed = await startedLesson(school);
      await workflowService.recordOutcome(school.instructor, missed.id, {
        result: LessonStatus.NO_SHOW,
      });
      await school.practice({ scheduledAt: at(10) });
      await school.practice({
        scheduledAt: at(14),
        status: LessonStatus.CANCELLED,
        cancelledAt: new Date(),
      });

      const expected = {
        studentId: school.student1.id,
        completedLessons: 1,
        completedMinutes: 120,
        noShows: 1,
        cancelled: 1,
        upcoming: 1,
        awaitingOutcome: 0,
        lastCompletedAt: done.scheduledAt,
      };
      await expect(
        practiceLessonsService.progress(school.student1, {}),
      ).resolves.toEqual(expected);
      await expect(
        practiceLessonsService.progress(school.admin, {
          studentId: school.student1.id,
        }),
      ).resolves.toEqual(expected);
    });
  });
});
