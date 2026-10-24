import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  InvitationStatus,
  TrainingStatus,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RefreshTokenService } from '../auth/refresh-token.service';
import {
  INSTRUCTOR_HAS_CARS_MESSAGE,
  INSTRUCTOR_HAS_LESSONS_MESSAGE,
  MEMBER_ROLE_CONCURRENT_MESSAGE,
  MEMBER_ROLE_FORBIDDEN_MESSAGE,
  MEMBER_ROLE_STATUS_MESSAGE,
  SELF_ROLE_MESSAGE,
  STUDENT_HAS_ASSIGNMENTS_MESSAGE,
  STUDENT_HAS_HISTORY_MESSAGE,
  TEACHER_HAS_GROUPS_MESSAGE,
  UsersService,
} from './users.service';

function actor(role: UserRole, id = `${role.toLowerCase()}-1`): User {
  return { id, role, organizationId: 'org-1' } as User;
}

function memberRow(
  overrides: Partial<{
    id: string;
    role: UserRole;
    status: UserStatus;
    organizationId: string;
    deletedAt: Date | null;
  }> = {},
) {
  return {
    id: 'user-2',
    email: 'member@example.com',
    firstName: 'Тарас',
    lastName: 'Шевченко',
    phone: null,
    role: UserRole.TEACHER,
    status: UserStatus.ACTIVE,
    organizationId: 'org-1',
    deletedAt: null,
    instructorCars: [],
    receivedInvitations: [],
    ...overrides,
  };
}

describe('UsersService.changeMemberRole', () => {
  let service: UsersService;
  let current: ReturnType<typeof memberRow>;

  const tx = {
    group: { count: jest.fn() },
    car: { count: jest.fn() },
    student: {
      count: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
      upsert: jest.fn(),
    },
    drivingLesson: { count: jest.fn() },
    enrollment: { count: jest.fn() },
    lessonAttendance: { count: jest.fn() },
    invitation: { updateMany: jest.fn() },
    user: { updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
  };
  const prisma = {
    organization: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const refreshTokenService = { revokeAllForUser: jest.fn() };

  function given(row: ReturnType<typeof memberRow>) {
    current = row;
    prisma.user.findUnique.mockResolvedValue(row);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      deletedAt: null,
    });
    prisma.$transaction.mockImplementation(
      (callback: (client: typeof tx) => unknown) => callback(tx),
    );
    for (const counter of [
      tx.group.count,
      tx.car.count,
      tx.student.count,
      tx.drivingLesson.count,
      tx.enrollment.count,
      tx.lessonAttendance.count,
    ]) {
      counter.mockResolvedValue(0);
    }
    tx.student.findUnique.mockResolvedValue(null);
    tx.user.updateMany.mockResolvedValue({ count: 1 });
    tx.user.findUniqueOrThrow.mockImplementation(() => {
      const calls = tx.user.updateMany.mock.calls as Array<
        [{ data: { role: UserRole } }]
      >;
      const [{ data }] = calls[calls.length - 1];
      return Promise.resolve({ ...current, role: data.role });
    });
    refreshTokenService.revokeAllForUser.mockResolvedValue(undefined);
    given(memberRow());

    service = new UsersService(
      prisma as unknown as PrismaService,
      refreshTokenService as unknown as RefreshTokenService,
    );
  });

  it('changes the role of an active member and revokes sessions', async () => {
    const result = await service.changeMemberRole(
      actor(UserRole.ADMIN),
      'user-2',
      UserRole.INSTRUCTOR,
    );

    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'user-2',
        role: UserRole.TEACHER,
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
      data: {
        role: UserRole.INSTRUCTOR,
        tokensInvalidBefore: expect.any(Date),
      },
    });
    expect(refreshTokenService.revokeAllForUser).toHaveBeenCalledWith('user-2');
    expect(tx.invitation.updateMany).not.toHaveBeenCalled();
    expect(result.role).toBe(UserRole.INSTRUCTOR);
  });

  it('changes the role of an invited member together with the pending invitation', async () => {
    given(memberRow({ status: UserStatus.INVITED }));

    const result = await service.changeMemberRole(
      actor(UserRole.OWNER),
      'user-2',
      UserRole.ADMIN,
    );

    expect(tx.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: UserRole.ADMIN } }),
    );
    expect(tx.invitation.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-2',
        status: InvitationStatus.PENDING,
        acceptedAt: null,
      },
      data: { role: UserRole.ADMIN },
    });
    expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
    expect(result.role).toBe(UserRole.ADMIN);
  });

  it('creates a student profile when the new role is STUDENT', async () => {
    await service.changeMemberRole(
      actor(UserRole.ADMIN),
      'user-2',
      UserRole.STUDENT,
    );

    expect(tx.student.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-2' },
      update: {},
      create: {
        userId: 'user-2',
        organizationId: 'org-1',
        trainingStatus: TrainingStatus.INVITED,
      },
    });
  });

  it('removes an unused student profile when leaving STUDENT', async () => {
    given(memberRow({ role: UserRole.STUDENT, status: UserStatus.INVITED }));
    tx.student.findUnique.mockResolvedValue({
      groupId: null,
      instructorId: null,
      carId: null,
    });

    await service.changeMemberRole(
      actor(UserRole.ADMIN),
      'user-2',
      UserRole.TEACHER,
    );

    expect(tx.student.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-2' },
    });
    expect(tx.student.upsert).not.toHaveBeenCalled();
  });

  it('does nothing when the role is already set', async () => {
    const result = await service.changeMemberRole(
      actor(UserRole.OWNER),
      'user-2',
      UserRole.TEACHER,
    );

    expect(result.role).toBe(UserRole.TEACHER);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
  });

  it.each([UserStatus.BLOCKED, UserStatus.ARCHIVED])(
    'does not change the role of a %s member',
    async (status) => {
      given(memberRow({ status }));

      const error = await service
        .changeMemberRole(actor(UserRole.OWNER), 'user-2', UserRole.STUDENT)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual({
        statusCode: 409,
        errors: [{ field: 'role', message: MEMBER_ROLE_STATUS_MESSAGE }],
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('does not let an admin promote to ADMIN', async () => {
    const error = await service
      .changeMemberRole(actor(UserRole.ADMIN), 'user-2', UserRole.ADMIN)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).message).toBe(
      MEMBER_ROLE_FORBIDDEN_MESSAGE,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not let anyone assign OWNER', async () => {
    await expect(
      service.changeMemberRole(actor(UserRole.OWNER), 'user-2', UserRole.OWNER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([UserRole.OWNER, UserRole.ADMIN])(
    'does not let %s change the organization owner',
    async (role) => {
      given(memberRow({ role: UserRole.OWNER }));

      await expect(
        service.changeMemberRole(actor(role), 'user-2', UserRole.ADMIN),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('does not let an admin change another admin', async () => {
    given(memberRow({ role: UserRole.ADMIN }));

    await expect(
      service.changeMemberRole(
        actor(UserRole.ADMIN),
        'user-2',
        UserRole.TEACHER,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not let the actor change their own role', async () => {
    given(memberRow({ id: 'owner-1', role: UserRole.OWNER }));

    const error = await service
      .changeMemberRole(actor(UserRole.OWNER), 'owner-1', UserRole.ADMIN)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).message).toBe(SELF_ROLE_MESSAGE);
  });

  it.each([UserRole.TEACHER, UserRole.INSTRUCTOR, UserRole.STUDENT])(
    'does not let %s change roles',
    async (role) => {
      await expect(
        service.changeMemberRole(actor(role), 'user-2', UserRole.STUDENT),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('returns 404 for a member of another organization', async () => {
    given(memberRow({ organizationId: 'org-2' }));

    await expect(
      service.changeMemberRole(
        actor(UserRole.OWNER),
        'user-2',
        UserRole.STUDENT,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps the role of a teacher with groups', async () => {
    tx.group.count.mockResolvedValue(2);

    const error = await service
      .changeMemberRole(actor(UserRole.OWNER), 'user-2', UserRole.INSTRUCTOR)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      statusCode: 409,
      errors: [{ field: 'role', message: TEACHER_HAS_GROUPS_MESSAGE }],
    });
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });

  it('lists every binding of an instructor', async () => {
    given(memberRow({ role: UserRole.INSTRUCTOR }));
    tx.car.count.mockResolvedValue(1);
    tx.drivingLesson.count.mockResolvedValue(3);

    const error = await service
      .changeMemberRole(actor(UserRole.ADMIN), 'user-2', UserRole.TEACHER)
      .catch((caught: unknown) => caught);

    expect((error as ConflictException).getResponse()).toEqual({
      statusCode: 409,
      errors: [
        { field: 'role', message: INSTRUCTOR_HAS_CARS_MESSAGE },
        { field: 'role', message: INSTRUCTOR_HAS_LESSONS_MESSAGE },
      ],
    });
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });

  it('keeps the role of a student with assignments and history', async () => {
    given(memberRow({ role: UserRole.STUDENT }));
    tx.student.findUnique.mockResolvedValue({
      groupId: 'group-1',
      instructorId: null,
      carId: null,
    });
    tx.enrollment.count.mockResolvedValue(1);

    const error = await service
      .changeMemberRole(actor(UserRole.ADMIN), 'user-2', UserRole.TEACHER)
      .catch((caught: unknown) => caught);

    expect((error as ConflictException).getResponse()).toEqual({
      statusCode: 409,
      errors: [
        { field: 'role', message: STUDENT_HAS_ASSIGNMENTS_MESSAGE },
        { field: 'role', message: STUDENT_HAS_HISTORY_MESSAGE },
      ],
    });
    expect(tx.student.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects a concurrent change', async () => {
    tx.user.updateMany.mockResolvedValue({ count: 0 });

    const error = await service
      .changeMemberRole(actor(UserRole.OWNER), 'user-2', UserRole.STUDENT)
      .catch((caught: unknown) => caught);

    expect((error as ConflictException).getResponse()).toEqual({
      statusCode: 409,
      errors: [{ field: 'role', message: MEMBER_ROLE_CONCURRENT_MESSAGE }],
    });
    expect(tx.student.upsert).not.toHaveBeenCalled();
    expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
  });
});
