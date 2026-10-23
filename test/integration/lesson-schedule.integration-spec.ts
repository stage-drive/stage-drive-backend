import { execFileSync } from 'child_process';
import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  DrivingLessonStatus,
  EnrollmentStatus,
  GroupStatus,
  LessonStatus,
  LicenseCategory,
  PrismaClient,
  TrainingStatus,
  Transmission,
  User,
  UserRole,
} from '@prisma/client';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { lockGroup } from '../../src/common/prisma/group-lock';
import {
  lockPracticeLesson,
  lockScheduleResources,
  scheduleLockKey,
} from '../../src/common/prisma/schedule-lock';
import { DashboardService } from '../../src/modules/dashboard/dashboard.service';
import {
  GROUP_CLOSED_CANCELLATION_REASON,
  GroupsService,
} from '../../src/modules/groups/groups.service';
import type { InvitationEmailQueue } from '../../src/modules/invitations/invitation-email.queue';
import {
  LESSON_GROUP_CLOSED_MESSAGE,
  LESSON_GROUP_NOT_OPEN_MESSAGE,
  LESSON_NOT_CANCELLABLE_MESSAGE,
  LessonsService,
} from '../../src/modules/lessons/lessons.service';
import type { PersonalScheduleDto } from '../../src/modules/lessons/lessons.dto';
import { PersonalScheduleService } from '../../src/modules/lessons/personal-schedule.service';
import type { LessonConflict } from '../../src/modules/lessons/schedule-conflicts';
import { StudentsService } from '../../src/modules/students/students.service';
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
    lessonsService = new LessonsService(service);
    groupsService = new GroupsService(
      service,
      new StudentsService(service, {} as InvitationEmailQueue),
    );
    dashboardService = new DashboardService(service);
    scheduleService = new PersonalScheduleService(service);
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
      status?: DrivingLessonStatus;
      cancelledAt?: Date;
    }) =>
      prisma.drivingLesson.create({
        data: {
          organizationId: organization.id,
          instructorId: instructor.id,
          carId: car1.id,
          studentId: student1.id,
          ...data,
        },
      });
    const theory = (scheduledAt: Date, durationMin = 90) =>
      prisma.lesson.create({
        data: {
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
            groupId: school.group.id,
            topic: 'Дорожні знаки',
            scheduledAt: at(16),
            ...data,
          },
        });

      await expect(
        school.practice({
          scheduledAt: at(10),
          status: DrivingLessonStatus.CANCELLED,
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
        status: DrivingLessonStatus.CANCELLED,
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
        status: DrivingLessonStatus.CANCELLED,
        cancellationReason: 'Авто на ремонті',
        car: { id: school.car1.id },
      });

      await expect(countLessons()).resolves.toBe(before);
      const row = await prisma.drivingLesson.findUniqueOrThrow({
        where: { id: lesson.id },
      });
      expect(row).toMatchObject({
        status: DrivingLessonStatus.CANCELLED,
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
        status: DrivingLessonStatus.SCHEDULED,
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
          status: DrivingLessonStatus.CANCELLED,
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
        durationMin: 60,
        status: DrivingLessonStatus.SCHEDULED,
      });
      const dashboard = await dashboardService.getInstructorDashboard(
        school.instructor,
      );
      expect(dashboard.upcomingLessons.map((l) => l.id)).toEqual([created.id]);
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
        scheduledAt: at(12),
        status: DrivingLessonStatus.CANCELLED,
        cancelledAt: new Date(),
      });

      await expect(
        practiceAt(school, school.student1.id, at(11)),
      ).resolves.toMatchObject({ scheduledAt: at(11) });
      await expect(
        practiceAt(school, school.student1.id, at(12)),
      ).resolves.toMatchObject({ scheduledAt: at(12) });
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
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        lessonsService.createPractice(school.admin, {
          studentId: school.student1.id,
          instructorId: other.instructor.id,
          scheduledAt,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        lessonsService.createPractice(school.admin, {
          studentId: school.student1.id,
          carId: other.car1.id,
          scheduledAt,
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
        data: { groupId: group.id, topic: 'Інша група', scheduledAt },
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
          status: DrivingLessonStatus.CANCELLED,
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
});
