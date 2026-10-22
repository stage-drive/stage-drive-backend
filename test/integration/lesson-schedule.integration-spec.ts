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
  lockScheduleResources,
  scheduleLockKey,
} from '../../src/common/prisma/schedule-lock';
import { GroupsService } from '../../src/modules/groups/groups.service';
import type { InvitationEmailQueue } from '../../src/modules/invitations/invitation-email.queue';
import {
  LESSON_GROUP_CLOSED_MESSAGE,
  LessonsService,
} from '../../src/modules/lessons/lessons.service';
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
    const teacher = await prisma.user.create({
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
});
