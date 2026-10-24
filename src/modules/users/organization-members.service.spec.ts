import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  CarStatus,
  InvitationStatus,
  LicenseCategory,
  Prisma,
  Transmission,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RefreshTokenService } from '../auth/refresh-token.service';
import {
  INVITED_STATUS_MESSAGE,
  MEMBER_NOT_FOUND_MESSAGE,
  MEMBER_ROLE_FILTER_MESSAGE,
  MEMBER_STATUS_TRANSITION_MESSAGE,
  NO_MEMBER_FIELDS_MESSAGE,
  ORGANIZATION_NOT_FOUND_MESSAGE,
  SELF_PROFILE_MESSAGE,
  SELF_STATUS_MESSAGE,
  SELF_UPDATE_MESSAGE,
  UsersService,
} from './users.service';

function actor(role: UserRole, id = `${role.toLowerCase()}-1`): User {
  return {
    id,
    role,
    organizationId: 'org-1',
  } as User;
}

function memberRow(
  overrides: Partial<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    role: UserRole;
    status: UserStatus;
    organizationId: string;
    deletedAt: Date | null;
    instructorCars: Array<{
      id: string;
      organizationId: string;
      plateNumber: string;
      category: LicenseCategory;
      transmission: Transmission;
      status: CarStatus;
    }>;
    receivedInvitations: Array<{
      id: string;
      status: InvitationStatus;
      expiresAt: Date;
    }>;
  }> = {},
) {
  return {
    id: 'user-2',
    email: 'instructor@example.com',
    firstName: 'Тарас',
    lastName: 'Шевченко',
    phone: '+380991112233',
    role: UserRole.INSTRUCTOR,
    status: UserStatus.ACTIVE,
    organizationId: 'org-1',
    deletedAt: null,
    instructorCars: [
      {
        id: 'car-1',
        organizationId: 'org-1',
        plateNumber: 'AA1234BB',
        category: LicenseCategory.B,
        transmission: Transmission.MANUAL,
        status: CarStatus.AVAILABLE,
      },
    ],
    receivedInvitations: [
      {
        id: 'invite-1',
        status: InvitationStatus.ACCEPTED,
        expiresAt: new Date('2026-11-01T00:00:00.000Z'),
      },
    ],
    ...overrides,
  };
}

describe('UsersService organization members', () => {
  let service: UsersService;
  const prisma = {
    organization: { findUnique: jest.fn() },
    user: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const refreshTokenService = {
    revokeAllForUser: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      deletedAt: null,
    });
    prisma.user.findMany.mockResolvedValue([memberRow()]);
    prisma.user.count.mockResolvedValue(1);
    prisma.user.findUnique.mockResolvedValue(memberRow());
    prisma.user.update.mockImplementation(
      ({ data }: { data: Prisma.UserUpdateInput }) => {
        const results = prisma.user.findUnique.mock.results;
        const last: unknown = results[results.length - 1]?.value;
        return Promise.resolve(last).then((current) => {
          const currentRow =
            typeof current === 'object' && current !== null
              ? (current as Record<string, unknown>)
              : memberRow();
          return { ...currentRow, ...data };
        });
      },
    );
    refreshTokenService.revokeAllForUser.mockResolvedValue(undefined);

    service = new UsersService(
      prisma as unknown as PrismaService,
      refreshTokenService as unknown as RefreshTokenService,
    );
  });

  describe('listMembers', () => {
    it('returns members of the owner organization, including invited and archived', async () => {
      const invited = memberRow({
        id: 'user-invited',
        role: UserRole.TEACHER,
        status: UserStatus.INVITED,
        instructorCars: [],
        receivedInvitations: [
          {
            id: 'invite-pending',
            status: InvitationStatus.PENDING,
            expiresAt: new Date('2026-12-01T00:00:00.000Z'),
          },
        ],
      });
      const archived = memberRow({
        id: 'user-archived',
        role: UserRole.STUDENT,
        status: UserStatus.ARCHIVED,
        instructorCars: [
          {
            id: 'car-foreign',
            organizationId: 'org-2',
            plateNumber: 'XX0000XX',
            category: LicenseCategory.B,
            transmission: Transmission.MANUAL,
            status: CarStatus.AVAILABLE,
          },
        ],
      });
      prisma.user.findMany.mockResolvedValue([invited, archived]);
      prisma.user.count.mockResolvedValue(2);

      const result = await service.listMembers(actor(UserRole.OWNER), {});

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              {
                organizationId: 'org-1',
                role: {
                  in: [
                    UserRole.ADMIN,
                    UserRole.TEACHER,
                    UserRole.INSTRUCTOR,
                    UserRole.STUDENT,
                  ],
                },
                deletedAt: null,
              },
            ],
          },
          orderBy: [{ lastName: 'asc' }, { id: 'asc' }],
          skip: 0,
          take: 20,
        }),
      );
      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
      });
      expect(result.users.map((user) => user.status)).toEqual([
        UserStatus.INVITED,
        UserStatus.ARCHIVED,
      ]);
      expect(result.users[0]).toMatchObject({
        id: 'user-invited',
        cars: [],
        invitation: {
          id: 'invite-pending',
          status: InvitationStatus.PENDING,
        },
      });
      expect(result.users[1].cars).toEqual([]);
    });

    it('limits an admin to teachers, instructors and students', async () => {
      await service.listMembers(actor(UserRole.ADMIN), {});

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              {
                organizationId: 'org-1',
                role: {
                  in: [UserRole.TEACHER, UserRole.INSTRUCTOR, UserRole.STUDENT],
                },
                deletedAt: null,
              },
            ],
          },
        }),
      );
    });

    it('applies search, filters, sorting and pagination', async () => {
      await service.listMembers(actor(UserRole.OWNER), {
        search: 'Тарас Шевченко',
        role: UserRole.INSTRUCTOR,
        status: UserStatus.BLOCKED,
        sortBy: 'email',
        sortOrder: 'desc',
        page: 2,
        limit: 10,
      });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              {
                organizationId: 'org-1',
                role: UserRole.INSTRUCTOR,
                deletedAt: null,
              },
              { status: UserStatus.BLOCKED },
              {
                OR: [
                  {
                    firstName: {
                      contains: 'Тарас Шевченко',
                      mode: 'insensitive',
                    },
                  },
                  {
                    lastName: {
                      contains: 'Тарас Шевченко',
                      mode: 'insensitive',
                    },
                  },
                  {
                    email: { contains: 'Тарас Шевченко', mode: 'insensitive' },
                  },
                  {
                    phone: { contains: 'Тарас Шевченко', mode: 'insensitive' },
                  },
                  {
                    AND: [
                      { firstName: { contains: 'Тарас', mode: 'insensitive' } },
                      {
                        lastName: { contains: 'Шевченко', mode: 'insensitive' },
                      },
                    ],
                  },
                  {
                    AND: [
                      {
                        firstName: {
                          contains: 'Шевченко',
                          mode: 'insensitive',
                        },
                      },
                      { lastName: { contains: 'Тарас', mode: 'insensitive' } },
                    ],
                  },
                ],
              },
            ],
          },
          orderBy: [{ email: 'desc' }, { id: 'asc' }],
          skip: 10,
          take: 10,
        }),
      );
    });

    it('rejects a role the actor is not allowed to see', async () => {
      const error = await service
        .listMembers(actor(UserRole.ADMIN), { role: UserRole.ADMIN })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'role', message: MEMBER_ROLE_FILTER_MESSAGE }],
      });
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('rejects a teacher', async () => {
      await expect(
        service.listMembers(actor(UserRole.TEACHER), {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('rejects a missing organization before querying users', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      const error = await service
        .listMembers(actor(UserRole.OWNER), {})
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).message).toBe(
        ORGANIZATION_NOT_FOUND_MESSAGE,
      );
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getMember', () => {
    it('returns the member with assigned cars and the latest invitation', async () => {
      const result = await service.getMember(actor(UserRole.OWNER), 'user-2');

      expect(result).toMatchObject({
        id: 'user-2',
        firstName: 'Тарас',
        lastName: 'Шевченко',
        email: 'instructor@example.com',
        phone: '+380991112233',
        role: UserRole.INSTRUCTOR,
        status: UserStatus.ACTIVE,
        organizationId: 'org-1',
        cars: [
          {
            id: 'car-1',
            plateNumber: 'AA1234BB',
            category: LicenseCategory.B,
            transmission: Transmission.MANUAL,
            status: CarStatus.AVAILABLE,
          },
        ],
        invitation: {
          id: 'invite-1',
          status: InvitationStatus.ACCEPTED,
        },
      });
    });

    it('hides cars that belong to another organization', async () => {
      prisma.user.findUnique.mockResolvedValue(
        memberRow({
          instructorCars: [
            {
              id: 'car-foreign',
              organizationId: 'org-2',
              plateNumber: 'XX0000XX',
              category: LicenseCategory.B,
              transmission: Transmission.MANUAL,
              status: CarStatus.AVAILABLE,
            },
          ],
        }),
      );

      const result = await service.getMember(actor(UserRole.ADMIN), 'user-2');

      expect(result.cars).toEqual([]);
    });

    it('returns an empty car list for a non-instructor', async () => {
      prisma.user.findUnique.mockResolvedValue(
        memberRow({ role: UserRole.TEACHER }),
      );

      const result = await service.getMember(actor(UserRole.ADMIN), 'user-2');

      expect(result.cars).toEqual([]);
    });

    it.each([
      ['missing', null],
      ['deleted', memberRow({ deletedAt: new Date('2026-01-01') })],
      ['foreign', memberRow({ organizationId: 'org-2' })],
    ])('returns 404 for a %s user', async (_label, row) => {
      prisma.user.findUnique.mockResolvedValue(row);

      const error = await service
        .getMember(actor(UserRole.OWNER), 'user-2')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).message).toBe(
        MEMBER_NOT_FOUND_MESSAGE,
      );
    });

    it('does not let an admin read an admin', async () => {
      prisma.user.findUnique.mockResolvedValue(
        memberRow({ role: UserRole.ADMIN }),
      );

      await expect(
        service.getMember(actor(UserRole.ADMIN), 'user-2'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('does not return the actor themselves', async () => {
      prisma.user.findUnique.mockResolvedValue(memberRow({ id: 'owner-1' }));

      const error = await service
        .getMember(actor(UserRole.OWNER), 'owner-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toBe(SELF_PROFILE_MESSAGE);
    });
  });

  describe('updateMember', () => {
    it('updates name and phone of an invited member', async () => {
      prisma.user.findUnique.mockResolvedValue(
        memberRow({ status: UserStatus.INVITED }),
      );

      const result = await service.updateMember(
        actor(UserRole.OWNER),
        'user-2',
        {
          firstName: '  Іван ',
          lastName: ' Франко ',
          phone: null,
        },
      );

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-2' },
        data: { firstName: 'Іван', lastName: 'Франко', phone: null },
        select: expect.any(Object),
      });
      expect(result).toMatchObject({
        firstName: 'Іван',
        lastName: 'Франко',
        phone: null,
        status: UserStatus.INVITED,
      });
    });

    it('rejects an empty patch', async () => {
      const error = await service
        .updateMember(actor(UserRole.ADMIN), 'user-2', {})
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'body', message: NO_MEMBER_FIELDS_MESSAGE }],
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a blank name', async () => {
      await expect(
        service.updateMember(actor(UserRole.ADMIN), 'user-2', {
          firstName: '   ',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('does not let the actor edit themselves', async () => {
      prisma.user.findUnique.mockResolvedValue(memberRow({ id: 'admin-1' }));

      const error = await service
        .updateMember(actor(UserRole.ADMIN), 'admin-1', { firstName: 'Інше' })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toBe(SELF_UPDATE_MESSAGE);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it.each([UserRole.OWNER, UserRole.ADMIN])(
      'does not let %s edit the organization owner',
      async (role) => {
        prisma.user.findUnique.mockResolvedValue(
          memberRow({ role: UserRole.OWNER }),
        );

        await expect(
          service.updateMember(actor(role), 'user-2', { firstName: 'Інше' }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.user.update).not.toHaveBeenCalled();
      },
    );

    it('does not let an admin edit an admin', async () => {
      prisma.user.findUnique.mockResolvedValue(
        memberRow({ role: UserRole.ADMIN }),
      );

      await expect(
        service.updateMember(actor(UserRole.ADMIN), 'user-2', {
          firstName: 'Інше',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it.each([UserRole.TEACHER, UserRole.INSTRUCTOR, UserRole.STUDENT])(
      'does not let %s edit members',
      async (role) => {
        await expect(
          service.updateMember(actor(role), 'user-2', { firstName: 'Інше' }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.user.update).not.toHaveBeenCalled();
      },
    );

    it('returns 404 for a member of another organization', async () => {
      prisma.user.findUnique.mockResolvedValue(
        memberRow({ organizationId: 'org-2' }),
      );

      await expect(
        service.updateMember(actor(UserRole.OWNER), 'user-2', {
          firstName: 'Інше',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('changeMemberStatus', () => {
    it.each([
      [UserStatus.ACTIVE, UserStatus.BLOCKED],
      [UserStatus.ACTIVE, UserStatus.ARCHIVED],
      [UserStatus.BLOCKED, UserStatus.ARCHIVED],
    ])('revokes sessions when moving from %s to %s', async (from, to) => {
      prisma.user.findUnique.mockResolvedValue(memberRow({ status: from }));

      const result = await service.changeMemberStatus(
        actor(UserRole.OWNER),
        'user-2',
        to,
      );

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-2' },
        data: {
          status: to,
          tokensInvalidBefore: expect.any(Date),
        },
        select: expect.any(Object),
      });
      expect(refreshTokenService.revokeAllForUser).toHaveBeenCalledWith(
        'user-2',
      );
      expect(result.status).toBe(to);
    });

    it.each([
      [UserStatus.BLOCKED, UserStatus.ACTIVE],
      [UserStatus.ARCHIVED, UserStatus.ACTIVE],
    ])('restores %s to %s without revoking sessions', async (from, to) => {
      prisma.user.findUnique.mockResolvedValue(memberRow({ status: from }));

      await service.changeMemberStatus(actor(UserRole.ADMIN), 'user-2', to);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-2' },
        data: { status: to },
        select: expect.any(Object),
      });
      expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('does nothing when the status is already set', async () => {
      const result = await service.changeMemberStatus(
        actor(UserRole.OWNER),
        'user-2',
        UserStatus.ACTIVE,
      );

      expect(result.status).toBe(UserStatus.ACTIVE);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('does not activate or block an invited account', async () => {
      prisma.user.findUnique.mockResolvedValue(
        memberRow({ status: UserStatus.INVITED }),
      );

      const error = await service
        .changeMemberStatus(actor(UserRole.OWNER), 'user-2', UserStatus.ACTIVE)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual({
        statusCode: 409,
        errors: [{ field: 'status', message: INVITED_STATUS_MESSAGE }],
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('does not move an archived member straight to blocked', async () => {
      prisma.user.findUnique.mockResolvedValue(
        memberRow({ status: UserStatus.ARCHIVED }),
      );

      const error = await service
        .changeMemberStatus(actor(UserRole.OWNER), 'user-2', UserStatus.BLOCKED)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual({
        statusCode: 409,
        errors: [
          { field: 'status', message: MEMBER_STATUS_TRANSITION_MESSAGE },
        ],
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('does not let the actor change their own status', async () => {
      prisma.user.findUnique.mockResolvedValue(memberRow({ id: 'owner-1' }));

      const error = await service
        .changeMemberStatus(
          actor(UserRole.OWNER),
          'owner-1',
          UserStatus.BLOCKED,
        )
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toBe(SELF_STATUS_MESSAGE);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('does not let an admin change another admin', async () => {
      prisma.user.findUnique.mockResolvedValue(
        memberRow({ role: UserRole.ADMIN }),
      );

      await expect(
        service.changeMemberStatus(
          actor(UserRole.ADMIN),
          'user-2',
          UserStatus.BLOCKED,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it.each([UserRole.OWNER, UserRole.ADMIN])(
      'does not let %s change the organization owner',
      async (role) => {
        prisma.user.findUnique.mockResolvedValue(
          memberRow({ role: UserRole.OWNER }),
        );

        await expect(
          service.changeMemberStatus(
            actor(role),
            'user-2',
            UserStatus.ARCHIVED,
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
      },
    );

    it.each([UserRole.TEACHER, UserRole.INSTRUCTOR, UserRole.STUDENT])(
      'does not let %s change statuses',
      async (role) => {
        await expect(
          service.changeMemberStatus(actor(role), 'user-2', UserStatus.BLOCKED),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
      },
    );

    it('returns 404 for a member of another organization', async () => {
      prisma.user.findUnique.mockResolvedValue(
        memberRow({ organizationId: 'org-2' }),
      );

      await expect(
        service.changeMemberStatus(
          actor(UserRole.OWNER),
          'user-2',
          UserStatus.BLOCKED,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
