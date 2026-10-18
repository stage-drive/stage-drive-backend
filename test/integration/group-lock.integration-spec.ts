import { execFileSync } from 'child_process';
import { ConflictException, Logger } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  EnrollmentStatus,
  GroupStatus,
  PrismaClient,
  TrainingStatus,
  User,
  UserRole,
} from '@prisma/client';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { lockGroup } from '../../src/common/prisma/group-lock';
import { GroupsService } from '../../src/modules/groups/groups.service';
import type { InvitationEmailQueue } from '../../src/modules/invitations/invitation-email.queue';
import {
  GROUP_NOT_ASSIGNABLE_MESSAGE,
  StudentsService,
} from '../../src/modules/students/students.service';
import type { PrismaService } from '../../src/prisma/prisma.service';

/** How long a blocked request must stay pending to count as waiting on the lock. */
const LOCK_WAIT_MS = 300;
/** An unblocked request must finish well before the 5 s transaction timeout. */
const UNBLOCKED_WITHIN_MS = 2000;

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

/**
 * Real GroupsService / StudentsService against real Postgres. The competing
 * request is a raw transaction that takes the same lock and then pauses, so
 * the interleaving is deterministic. Each scenario fails if the service under
 * test stops taking its lock.
 */
describe('Group row locks (integration, real Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let groupsService: GroupsService;
  let studentsService: StudentsService;
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

    studentsService = new StudentsService(
      prisma as unknown as PrismaService,
      {} as InvitationEmailQueue,
    );
    groupsService = new GroupsService(
      prisma as unknown as PrismaService,
      studentsService,
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  async function createSchool() {
    sequence += 1;
    const organization = await prisma.organization.create({
      data: {
        name: `Lock School ${sequence}`,
        slug: `lock-school-${sequence}`,
        email: `lock-${sequence}@example.com`,
      },
    });
    const userData = (role: UserRole) => ({
      organizationId: organization.id,
      email: `${role.toLowerCase()}-${sequence}@lock.example.com`,
      firstName: 'Lock',
      lastName: role,
      role,
    });
    const admin: User = await prisma.user.create({
      data: userData(UserRole.ADMIN),
    });
    const teacher = await prisma.user.create({
      data: userData(UserRole.TEACHER),
    });
    const student = await prisma.user.create({
      data: {
        ...userData(UserRole.STUDENT),
        studentProfile: {
          create: {
            organizationId: organization.id,
            trainingStatus: TrainingStatus.ACTIVE,
          },
        },
      },
    });
    const group = await prisma.group.create({
      data: {
        name: `Група ${sequence}`,
        status: GroupStatus.ACTIVE,
        organizationId: organization.id,
        teacherId: teacher.id,
      },
    });
    return { organization, admin, student, group };
  }

  it('completes an enrollment that commits while the group is being closed', async () => {
    const { organization, admin, student, group } = await createSchool();
    const enrolled = deferred();
    const commit = deferred();

    // In-flight assignGroup: holds FOR SHARE and has inserted, not committed.
    const enrolling = prisma.$transaction(async (tx) => {
      await lockGroup(tx, group.id, organization.id, 'share');
      await tx.enrollment.create({
        data: {
          groupId: group.id,
          studentId: student.id,
          status: EnrollmentStatus.ACTIVE,
        },
      });
      enrolled.resolve();
      await commit.promise;
    });

    try {
      await enrolled.promise;
      const closing = groupsService.changeStatus(admin, group.id, {
        status: GroupStatus.COMPLETED,
      });
      const closingState = track(closing);

      await delay(LOCK_WAIT_MS);
      expect(closingState.settled).toBe(false);

      commit.resolve();
      await enrolling;
      const result = await closing;

      expect(result.status).toBe(GroupStatus.COMPLETED);
      expect(result.studentsCount).toBe(0);
      const enrollment = await prisma.enrollment.findUniqueOrThrow({
        where: {
          groupId_studentId: { groupId: group.id, studentId: student.id },
        },
      });
      expect(enrollment.status).toBe(EnrollmentStatus.COMPLETED);
    } finally {
      commit.resolve();
      await enrolling.catch(() => undefined);
    }
  });

  it('rejects an enrollment into a group that gets closed while it waits', async () => {
    const { organization, admin, student, group } = await createSchool();
    const closed = deferred();
    const commit = deferred();

    // In-flight changeStatus: holds FOR UPDATE and has saved COMPLETED.
    const closing = prisma.$transaction(async (tx) => {
      await lockGroup(tx, group.id, organization.id, 'update');
      await tx.group.update({
        where: { id: group.id },
        data: { status: GroupStatus.COMPLETED },
      });
      closed.resolve();
      await commit.promise;
    });

    try {
      await closed.promise;
      const assigning = studentsService.assignGroup(admin, student.id, {
        groupId: group.id,
      });
      const assigningState = track(assigning);

      await delay(LOCK_WAIT_MS);
      expect(assigningState.settled).toBe(false);

      commit.resolve();
      await closing;

      const error: unknown = await assigning.catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe(
        GROUP_NOT_ASSIGNABLE_MESSAGE,
      );
      await expect(
        prisma.enrollment.count({ where: { groupId: group.id } }),
      ).resolves.toBe(0);
    } finally {
      commit.resolve();
      await closing.catch(() => undefined);
    }
  });

  it('makes a second status change read the status saved by the first', async () => {
    const { organization, admin, group } = await createSchool();
    const archived = deferred();
    const commit = deferred();

    // In-flight ACTIVE → ARCHIVED from another admin.
    const archiving = prisma.$transaction(async (tx) => {
      await lockGroup(tx, group.id, organization.id, 'update');
      await tx.group.update({
        where: { id: group.id },
        data: { status: GroupStatus.ARCHIVED },
      });
      archived.resolve();
      await commit.promise;
    });

    try {
      await archived.promise;
      const completing = groupsService.changeStatus(admin, group.id, {
        status: GroupStatus.COMPLETED,
      });
      const completingState = track(completing);

      await delay(LOCK_WAIT_MS);
      expect(completingState.settled).toBe(false);

      commit.resolve();
      await archiving;

      const error: unknown = await completing.catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        statusCode: 409,
        currentStatus: GroupStatus.ARCHIVED,
      });
      await expect(
        prisma.group.findUniqueOrThrow({ where: { id: group.id } }),
      ).resolves.toMatchObject({ status: GroupStatus.ARCHIVED });
    } finally {
      commit.resolve();
      await archiving.catch(() => undefined);
    }
  });

  it('does not lock the row when the organization does not match', async () => {
    const { admin, group } = await createSchool();
    const other = await createSchool();
    const locked = deferred();
    const commit = deferred();

    // Same group id, wrong organization: the lock query matches no row.
    const foreignLock = prisma.$transaction(async (tx) => {
      await lockGroup(tx, group.id, other.organization.id, 'update');
      locked.resolve();
      await commit.promise;
    });

    try {
      await locked.promise;
      const closing = groupsService.changeStatus(admin, group.id, {
        status: GroupStatus.ARCHIVED,
      });

      // The foreign lock is still held: if it had locked the row, closing would
      // wait for it (up to the 5 s transaction timeout) and lose this race.
      const winner = await Promise.race([
        closing.then(() => 'closed'),
        delay(UNBLOCKED_WITHIN_MS).then(() => 'blocked'),
      ]);
      expect(winner).toBe('closed');
      await expect(closing).resolves.toMatchObject({
        status: GroupStatus.ARCHIVED,
      });
    } finally {
      commit.resolve();
      await foreignLock.catch(() => undefined);
    }
  });
});
