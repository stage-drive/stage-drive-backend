import {
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User, UserRole, UserStatus } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EMAIL_ALREADY_EXISTS_MESSAGE,
  invitationAcceptUrl,
} from '../invitations/invitations.service';
import { MailService } from '../mail/mail.service';
import { ListStudentsQueryDto } from './students.dto';
import {
  GROUP_NOT_FOUND_MESSAGE,
  NO_STUDENT_FIELDS_MESSAGE,
  STUDENT_NOT_FOUND_MESSAGE,
  StudentsService,
} from './students.service';

function actor(role: UserRole, organizationId = 'org-1'): User {
  return {
    id: `${role.toLowerCase()}-1`,
    role,
    organizationId,
  } as User;
}

function studentRow(
  overrides: Partial<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    avatarUrl: string | null;
    role: UserRole;
    status: UserStatus;
    organizationId: string;
    createdAt: Date;
    deletedAt: Date | null;
  }> = {},
) {
  return {
    id: 'student-1',
    email: 'student@example.com',
    firstName: 'Олена',
    lastName: 'Коваль',
    phone: '+380991234567',
    avatarUrl: null,
    role: UserRole.STUDENT,
    status: UserStatus.ACTIVE,
    organizationId: 'org-1',
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

describe('StudentsService', () => {
  const organization = {
    id: 'org-1',
    name: 'Автошкола Drive',
    deletedAt: null,
  };

  const prisma = {
    organization: { findUnique: jest.fn() },
    user: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    group: { findUnique: jest.fn() },
    student: { create: jest.fn() },
    invitation: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  const mailService = {
    sendEmail: jest.fn(),
  };

  let service: StudentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.organization.findUnique.mockResolvedValue(organization);
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
    mailService.sendEmail.mockResolvedValue(undefined);
    service = new StudentsService(
      prisma as unknown as PrismaService,
      mailService as unknown as MailService,
    );
  });

  it('returns students of the admin organization with default sort and pagination', async () => {
    const row = studentRow();
    prisma.user.findMany.mockResolvedValue([row]);
    prisma.user.count.mockResolvedValue(1);

    await expect(service.list(actor(UserRole.ADMIN), {})).resolves.toEqual({
      students: [
        {
          id: row.id,
          email: row.email,
          firstName: row.firstName,
          lastName: row.lastName,
          phone: row.phone,
          avatarUrl: null,
          role: UserRole.STUDENT,
          status: UserStatus.ACTIVE,
          organizationId: 'org-1',
          createdAt: row.createdAt,
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              organizationId: 'org-1',
              role: UserRole.STUDENT,
              deletedAt: null,
            },
          ],
        },
        orderBy: [{ lastName: 'asc' }, { id: 'asc' }],
        skip: 0,
        take: 20,
      }),
    );
    const queryArgs = prisma.user.findMany.mock.calls[0][0] as {
      select: Record<string, boolean>;
    };
    expect(queryArgs.select.email).toBe(true);
    expect(queryArgs.select).not.toHaveProperty('passwordHash');
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            organizationId: 'org-1',
            role: UserRole.STUDENT,
            deletedAt: null,
          },
        ],
      },
    });
  });

  it.each([UserRole.TEACHER, UserRole.INSTRUCTOR] as const)(
    'limits %s to students of their organization',
    async (role) => {
      await service.list(actor(role, 'org-2'), {});

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              {
                organizationId: 'org-2',
                role: UserRole.STUDENT,
                deletedAt: null,
              },
            ],
          },
        }),
      );
    },
  );

  it('does not return a student from another organization', async () => {
    prisma.user.findMany.mockResolvedValue([
      studentRow(),
      studentRow({
        id: 'student-other',
        email: 'other@example.com',
        organizationId: 'org-2',
      }),
      studentRow({
        id: 'teacher-row',
        role: UserRole.TEACHER,
        email: 'teacher@example.com',
      }),
      studentRow({
        id: 'deleted-student',
        deletedAt: new Date('2026-02-01T00:00:00.000Z'),
      }),
    ]);
    prisma.user.count.mockResolvedValue(1);

    const result = await service.list(actor(UserRole.ADMIN), {});

    expect(result.students.map((student) => student.id)).toEqual(['student-1']);
    expect(result.students[0]).not.toHaveProperty('passwordHash');
    expect(result.students[0]).not.toHaveProperty('deletedAt');
  });

  it('applies search, status filter, sorting and pagination', async () => {
    const query: ListStudentsQueryDto = {
      search: '  Ivan Petrenko  ',
      status: UserStatus.ACTIVE,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      page: 2,
      limit: 5,
    };

    await service.list(actor(UserRole.ADMIN), query);

    const contains = (value: string) => ({
      contains: value,
      mode: 'insensitive',
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              organizationId: 'org-1',
              role: UserRole.STUDENT,
              deletedAt: null,
            },
            { status: UserStatus.ACTIVE },
            {
              OR: [
                { firstName: contains('Ivan Petrenko') },
                { lastName: contains('Ivan Petrenko') },
                { email: contains('Ivan Petrenko') },
                { phone: contains('Ivan Petrenko') },
                {
                  AND: [
                    { firstName: contains('Ivan') },
                    { lastName: contains('Petrenko') },
                  ],
                },
                {
                  AND: [
                    { firstName: contains('Petrenko') },
                    { lastName: contains('Ivan') },
                  ],
                },
              ],
            },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: 5,
        take: 5,
      }),
    );
  });

  it('ignores a blank search', async () => {
    await service.list(actor(UserRole.TEACHER), { search: '   ' });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              organizationId: 'org-1',
              role: UserRole.STUDENT,
              deletedAt: null,
            },
          ],
        },
      }),
    );
  });

  it('returns an empty page with zero totalPages', async () => {
    await expect(service.list(actor(UserRole.INSTRUCTOR), {})).resolves.toEqual(
      {
        students: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      },
    );
  });

  it.each([UserRole.OWNER, UserRole.STUDENT] as const)(
    'rejects %s before reading students',
    async (role) => {
      await expect(service.list(actor(role), {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.organization.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    },
  );

  it('returns 404 when the organization is missing', async () => {
    prisma.organization.findUnique.mockResolvedValue(null);

    await expect(
      service.list(actor(UserRole.ADMIN), {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('returns 404 when the organization is deleted', async () => {
    prisma.organization.findUnique.mockResolvedValue({
      ...organization,
      deletedAt: new Date(),
    });

    await expect(
      service.list(actor(UserRole.ADMIN), {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  describe('create', () => {
    const payload = {
      firstName: '  Олена ',
      lastName: ' Коваль ',
      email: 'Student@Example.com',
      phone: ' +380991234567 ',
    };

    const createdUser = {
      id: 'student-1',
      email: 'student@example.com',
      firstName: 'Олена',
      lastName: 'Коваль',
      phone: '+380991234567',
      role: UserRole.STUDENT,
      status: UserStatus.INVITED,
      organizationId: 'org-1',
    };

    const createdStudent = {
      id: 'profile-1',
      userId: 'student-1',
      organizationId: 'org-1',
      groupId: null as string | null,
      instructorId: null,
      carId: null,
    };

    const createdInvitation = {
      id: 'invite-1',
      email: 'student@example.com',
      role: UserRole.STUDENT,
      status: 'PENDING' as const,
      expiresAt: new Date('2026-10-07T12:00:00.000Z'),
      userId: 'student-1',
      organizationId: 'org-1',
    };

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(createdUser);
      prisma.student.create.mockImplementation(
        (args: { data: { groupId: string | null } }) =>
          Promise.resolve({
            ...createdStudent,
            groupId: args.data.groupId,
          }),
      );
      prisma.invitation.create.mockResolvedValue(createdInvitation);
      prisma.user.delete.mockResolvedValue(createdUser);
    });

    it('creates an INVITED STUDENT, a profile and a pending invitation in the actor organization', async () => {
      const result = await service.create(actor(UserRole.ADMIN), payload);

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: 'student@example.com',
          firstName: 'Олена',
          lastName: 'Коваль',
          phone: '+380991234567',
          passwordHash: null,
          role: UserRole.STUDENT,
          status: UserStatus.INVITED,
          organizationId: 'org-1',
        },
      });
      expect(prisma.student.create).toHaveBeenCalledWith({
        data: {
          userId: 'student-1',
          organizationId: 'org-1',
          groupId: null,
          instructorId: null,
          carId: null,
        },
      });
      expect(prisma.invitation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'student@example.com',
          role: UserRole.STUDENT,
          status: 'PENDING',
          invitedById: 'admin-1',
          userId: 'student-1',
          organizationId: 'org-1',
        }),
      });
      expect(result).toEqual({
        user: {
          id: 'student-1',
          firstName: 'Олена',
          lastName: 'Коваль',
          email: 'student@example.com',
          phone: '+380991234567',
          role: UserRole.STUDENT,
          status: UserStatus.INVITED,
          organizationId: 'org-1',
        },
        student: {
          id: 'profile-1',
          userId: 'student-1',
          organizationId: 'org-1',
          groupId: null,
          instructorId: null,
          carId: null,
        },
        invitation: {
          id: 'invite-1',
          email: 'student@example.com',
          role: UserRole.STUDENT,
          status: 'PENDING',
          expiresAt: createdInvitation.expiresAt,
          userId: 'student-1',
          organizationId: 'org-1',
        },
      });
      expect(result).not.toHaveProperty('token');
      expect(JSON.stringify(result)).not.toContain('tokenHash');
      expect(JSON.stringify(result)).not.toContain('passwordHash');
    });

    it('sets groupId when the selected group belongs to the same organization', async () => {
      prisma.group.findUnique.mockResolvedValue({
        id: 'group-1',
        organizationId: 'org-1',
      });

      const result = await service.create(actor(UserRole.OWNER), {
        ...payload,
        groupId: 'group-1',
      });

      expect(prisma.student.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-1',
          groupId: 'group-1',
          instructorId: null,
          carId: null,
        }),
      });
      expect(result.student.groupId).toBe('group-1');
      expect(result.student.instructorId).toBeNull();
      expect(result.student.carId).toBeNull();
      expect(result.user.organizationId).toBe('org-1');
    });

    it('does not create a student in another organization when the group belongs elsewhere', async () => {
      prisma.group.findUnique.mockResolvedValue({
        id: 'group-other',
        organizationId: 'org-2',
      });

      await expect(
        service.create(actor(UserRole.ADMIN, 'org-1'), {
          ...payload,
          groupId: 'group-other',
        }),
      ).rejects.toMatchObject({
        message: GROUP_NOT_FOUND_MESSAGE,
      });

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.student.create).not.toHaveBeenCalled();
      expect(prisma.invitation.create).not.toHaveBeenCalled();
      expect(mailService.sendEmail).not.toHaveBeenCalled();
    });

    it('rejects a missing group before creating a user', async () => {
      prisma.group.findUnique.mockResolvedValue(null);

      await expect(
        service.create(actor(UserRole.ADMIN), {
          ...payload,
          groupId: 'missing-group',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('emails the invitation accept link and stores only the token hash', async () => {
      await service.create(actor(UserRole.ADMIN), payload);

      const html = mailService.sendEmail.mock.calls[0][0].html as string;
      const tokenMatch = html.match(/invite\?token=([^"&\s<]+)/);
      if (!tokenMatch?.[1]) {
        throw new Error('invitation email did not contain a token');
      }
      const token = decodeURIComponent(tokenMatch[1]);

      expect(prisma.invitation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tokenHash: createHash('sha256').update(token).digest('hex'),
        }),
      });
      expect(mailService.sendEmail).toHaveBeenCalledWith({
        to: 'student@example.com',
        subject: 'Запрошення стати учнем — Автошкола Drive',
        html: expect.stringContaining(invitationAcceptUrl(token)),
      });
    });

    it('rejects a duplicate email', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'existing-1',
        email: 'student@example.com',
      });

      await expect(
        service.create(actor(UserRole.ADMIN), payload),
      ).rejects.toMatchObject({
        response: {
          statusCode: 409,
          errors: [{ field: 'email', message: EMAIL_ALREADY_EXISTS_MESSAGE }],
        },
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(mailService.sendEmail).not.toHaveBeenCalled();
    });

    it('maps a unique email constraint to the same conflict', async () => {
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.9.1',
          meta: { target: ['email'] },
        }),
      );

      await expect(
        service.create(actor(UserRole.OWNER), payload),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mailService.sendEmail).not.toHaveBeenCalled();
    });

    it('removes the created user when the invitation email fails', async () => {
      mailService.sendEmail.mockRejectedValue(
        new InternalServerErrorException('Failed to send email'),
      );

      await expect(
        service.create(actor(UserRole.ADMIN), payload),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'student-1' },
      });
    });

    it.each([UserRole.TEACHER, UserRole.INSTRUCTOR, UserRole.STUDENT] as const)(
      'rejects %s before writing',
      async (role) => {
        await expect(
          service.create(actor(role), payload),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.organization.findUnique).not.toHaveBeenCalled();
        expect(prisma.user.create).not.toHaveBeenCalled();
        expect(mailService.sendEmail).not.toHaveBeenCalled();
      },
    );

    it('returns 404 when the organization is deleted', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        ...organization,
        deletedAt: new Date(),
      });

      await expect(
        service.create(actor(UserRole.ADMIN), payload),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('card', () => {
    const profile = {
      id: 'profile-1',
      userId: 'student-1',
      organizationId: 'org-1',
      groupId: 'group-1' as string | null,
      instructorId: null,
      carId: null,
    };

    function cardRow(
      overrides: Partial<{
        id: string;
        organizationId: string;
        role: UserRole;
        status: UserStatus;
        deletedAt: Date | null;
        studentProfile: typeof profile | null;
      }> = {},
    ) {
      const { studentProfile, ...userOverrides } = overrides;
      return {
        ...studentRow(),
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        studentProfile: profile,
        ...userOverrides,
        ...(studentProfile !== undefined ? { studentProfile } : {}),
      };
    }

    const visibleCard = {
      id: 'student-1',
      email: 'student@example.com',
      firstName: 'Олена',
      lastName: 'Коваль',
      phone: '+380991234567',
      avatarUrl: null,
      role: UserRole.STUDENT,
      status: UserStatus.ACTIVE,
      organizationId: 'org-1',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      student: profile,
    };

    beforeEach(() => {
      prisma.user.findFirst.mockReset();
      prisma.user.update.mockReset();
      prisma.user.findFirst.mockResolvedValue(null);
    });

    it.each([
      UserRole.OWNER,
      UserRole.ADMIN,
      UserRole.TEACHER,
      UserRole.INSTRUCTOR,
    ] as const)('returns the student card for %s', async (role) => {
      prisma.user.findFirst.mockResolvedValue(cardRow());

      await expect(service.getById(actor(role), 'student-1')).resolves.toEqual(
        visibleCard,
      );
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'student-1',
          organizationId: 'org-1',
          role: UserRole.STUDENT,
          deletedAt: null,
        },
        select: expect.not.objectContaining({ passwordHash: true }),
      });
    });

    it('returns the card when the student profile row is missing', async () => {
      prisma.user.findFirst.mockResolvedValue(
        cardRow({ studentProfile: null }),
      );

      await expect(
        service.getById(actor(UserRole.ADMIN), 'student-1'),
      ).resolves.toMatchObject({
        id: 'student-1',
        student: null,
      });
    });

    it('does not return a student of another organization to ADMIN', async () => {
      prisma.user.findFirst.mockResolvedValue(cardRow());

      await expect(
        service.getById(actor(UserRole.ADMIN, 'org-2'), 'student-1'),
      ).rejects.toMatchObject({ message: STUDENT_NOT_FOUND_MESSAGE });
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'student-1',
            organizationId: 'org-2',
          }),
        }),
      );
    });

    it('hides a student profile that belongs to another organization', async () => {
      prisma.user.findFirst.mockResolvedValue(
        cardRow({
          studentProfile: { ...profile, organizationId: 'org-2' },
        }),
      );

      await expect(
        service.getById(actor(UserRole.ADMIN), 'student-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each(['deleted student', 'another role'] as const)(
      'returns 404 for a %s',
      async (kind) => {
        prisma.user.findFirst.mockResolvedValue(
          kind === 'deleted student'
            ? cardRow({ deletedAt: new Date('2026-03-01T00:00:00.000Z') })
            : cardRow({ role: UserRole.TEACHER }),
        );

        await expect(
          service.getById(actor(UserRole.ADMIN), 'student-1'),
        ).rejects.toBeInstanceOf(NotFoundException);
      },
    );

    it('returns 404 when the student does not exist', async () => {
      await expect(
        service.getById(actor(UserRole.TEACHER), 'missing-student'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects STUDENT before reading the card', async () => {
      await expect(
        service.getById(actor(UserRole.STUDENT), 'student-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('updates only firstName, lastName and phone and keeps system fields', async () => {
      const existing = cardRow({ status: UserStatus.INVITED });
      prisma.user.findFirst.mockResolvedValue(existing);
      prisma.user.update.mockImplementation(
        (args: { data: { firstName?: string; phone?: string | null } }) =>
          Promise.resolve({
            ...existing,
            ...args.data,
          }),
      );

      const result = await service.update(actor(UserRole.ADMIN), 'student-1', {
        firstName: '  Ірина ',
        phone: ' +380671112233 ',
        role: UserRole.OWNER,
        organizationId: 'org-2',
        status: UserStatus.BLOCKED,
      } as never);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'student-1' },
        data: { firstName: 'Ірина', phone: '+380671112233' },
        select: expect.any(Object),
      });
      const updateArgs = prisma.user.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
        select: Record<string, unknown>;
      };
      expect(updateArgs.data).not.toHaveProperty('role');
      expect(updateArgs.data).not.toHaveProperty('organizationId');
      expect(updateArgs.data).not.toHaveProperty('status');
      expect(updateArgs.select).not.toHaveProperty('passwordHash');
      expect(result).toMatchObject({
        firstName: 'Ірина',
        phone: '+380671112233',
        role: UserRole.STUDENT,
        status: UserStatus.INVITED,
        organizationId: 'org-1',
      });
    });

    it('clears the phone when null is sent', async () => {
      const existing = cardRow();
      prisma.user.findFirst.mockResolvedValue(existing);
      prisma.user.update.mockResolvedValue({ ...existing, phone: null });

      await expect(
        service.update(actor(UserRole.OWNER), 'student-1', { phone: null }),
      ).resolves.toMatchObject({ phone: null, status: UserStatus.ACTIVE });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { phone: null } }),
      );
    });

    it('rejects an empty update', async () => {
      await expect(
        service.update(actor(UserRole.ADMIN), 'student-1', {}),
      ).rejects.toMatchObject({
        response: {
          statusCode: 400,
          errors: [{ field: 'body', message: NO_STUDENT_FIELDS_MESSAGE }],
        },
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a blank name', async () => {
      await expect(
        service.update(actor(UserRole.ADMIN), 'student-1', {
          firstName: '   ',
        }),
      ).rejects.toMatchObject({
        response: {
          errors: [
            { field: 'firstName', message: "Заповніть обов'язкове поле." },
          ],
        },
      });
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it.each([UserRole.TEACHER, UserRole.INSTRUCTOR, UserRole.STUDENT] as const)(
      'rejects %s before updating a student',
      async (role) => {
        await expect(
          service.update(actor(role), 'student-1', { firstName: 'Ірина' }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(prisma.user.findFirst).not.toHaveBeenCalled();
      },
    );

    it('does not update a student of another organization', async () => {
      prisma.user.findFirst.mockResolvedValue(cardRow());

      await expect(
        service.update(actor(UserRole.ADMIN, 'org-2'), 'student-1', {
          lastName: 'Інша',
        }),
      ).rejects.toMatchObject({ message: STUDENT_NOT_FOUND_MESSAGE });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
