import {
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EnrollmentStatus,
  GroupStatus,
  LicenseCategory,
  Prisma,
  TrainingStatus,
  Transmission,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EMAIL_ALREADY_EXISTS_MESSAGE,
  invitationAcceptUrl,
} from '../invitations/invitations.service';
import { MailService } from '../mail/mail.service';
import { ListStudentsQueryDto } from './students.dto';
import {
  CAR_NOT_FOUND_MESSAGE,
  GROUP_NOT_ASSIGNABLE_MESSAGE,
  GROUP_NOT_FOUND_MESSAGE,
  INSTRUCTOR_CAR_MISMATCH_MESSAGE,
  INSTRUCTOR_NOT_ACTIVE_MESSAGE,
  INSTRUCTOR_NOT_FOUND_MESSAGE,
  INSTRUCTOR_ROLE_MESSAGE,
  NO_STUDENT_FIELDS_MESSAGE,
  STUDENT_ACTIVE_GROUP_MESSAGE,
  ARCHIVED_STUDENT_BOOKING_MESSAGE,
  STUDENT_NOT_FOUND_MESSAGE,
  STUDENT_PRACTICE_ACCESS_MESSAGE,
  STUDENT_TRAINING_STATUS_MESSAGE,
  TRAINING_STATUS_TRANSITION_MESSAGE,
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
    student: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    car: { findUnique: jest.fn() },
    enrollment: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
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
      category: null,
      transmission: null,
      trainingStatus: TrainingStatus.INVITED,
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
          trainingStatus: TrainingStatus.INVITED,
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
          category: null,
          transmission: null,
          trainingStatus: TrainingStatus.INVITED,
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
      category: null,
      transmission: null,
      trainingStatus: TrainingStatus.ACTIVE,
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

  describe('assignGroup', () => {
    const targetGroup = {
      id: 'group-new',
      organizationId: 'org-1',
      status: GroupStatus.ACTIVE,
    };

    function assignRow(
      overrides: {
        status?: UserStatus;
        organizationId?: string;
        role?: UserRole;
        deletedAt?: Date | null;
        studentProfile?: {
          id: string;
          userId: string;
          organizationId: string;
          groupId: string | null;
          instructorId: null;
          carId: null;
          trainingStatus?: TrainingStatus;
        } | null;
      } = {},
    ) {
      const { studentProfile, ...userOverrides } = overrides;
      return {
        ...studentRow(),
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        studentProfile: {
          id: 'profile-1',
          userId: 'student-1',
          organizationId: 'org-1',
          groupId: null as string | null,
          instructorId: null,
          carId: null,
          trainingStatus: TrainingStatus.ACTIVE,
        },
        ...userOverrides,
        ...(studentProfile !== undefined ? { studentProfile } : {}),
      };
    }

    beforeEach(() => {
      prisma.user.findFirst.mockResolvedValue(assignRow());
      prisma.group.findUnique.mockResolvedValue(targetGroup);
      prisma.enrollment.findFirst.mockResolvedValue(null);
      prisma.student.update.mockImplementation(
        (args: { data: { groupId: string } }) =>
          Promise.resolve({
            id: 'profile-1',
            userId: 'student-1',
            organizationId: 'org-1',
            groupId: args.data.groupId,
            instructorId: null,
            carId: null,
          }),
      );
      prisma.enrollment.upsert.mockResolvedValue({});
    });

    it.each([UserRole.OWNER, UserRole.ADMIN] as const)(
      'sets groupId and an active enrollment for %s',
      async (role) => {
        const result = await service.assignGroup(actor(role), 'student-1', {
          groupId: 'group-new',
        });

        expect(result.student?.groupId).toBe('group-new');
        expect(prisma.student.update).toHaveBeenCalledWith({
          where: { id: 'profile-1' },
          data: { groupId: 'group-new' },
        });
        expect(prisma.enrollment.upsert).toHaveBeenCalledWith({
          where: {
            groupId_studentId: {
              groupId: 'group-new',
              studentId: 'student-1',
            },
          },
          create: {
            groupId: 'group-new',
            studentId: 'student-1',
            status: EnrollmentStatus.ACTIVE,
          },
          update: { status: EnrollmentStatus.ACTIVE },
        });
      },
    );

    it('assigns a student to a planned group', async () => {
      prisma.group.findUnique.mockResolvedValue({
        ...targetGroup,
        status: GroupStatus.PLANNED,
      });

      await expect(
        service.assignGroup(actor(UserRole.ADMIN), 'student-1', {
          groupId: 'group-new',
        }),
      ).resolves.toMatchObject({ student: { groupId: 'group-new' } });
    });

    it('assigns an invited student who is not in a group yet', async () => {
      prisma.user.findFirst.mockResolvedValue(
        assignRow({ status: UserStatus.INVITED }),
      );

      await expect(
        service.assignGroup(actor(UserRole.ADMIN), 'student-1', {
          groupId: 'group-new',
        }),
      ).resolves.toMatchObject({
        status: UserStatus.INVITED,
        student: { groupId: 'group-new' },
      });
    });

    it('allows assigning the same open group again', async () => {
      prisma.user.findFirst.mockResolvedValue(
        assignRow({
          studentProfile: {
            id: 'profile-1',
            userId: 'student-1',
            organizationId: 'org-1',
            groupId: 'group-new',
            instructorId: null,
            carId: null,
          },
        }),
      );

      await expect(
        service.assignGroup(actor(UserRole.ADMIN), 'student-1', {
          groupId: 'group-new',
        }),
      ).resolves.toMatchObject({ student: { groupId: 'group-new' } });
      expect(prisma.student.update).toHaveBeenCalled();
    });

    it.each([UserRole.TEACHER, UserRole.INSTRUCTOR, UserRole.STUDENT] as const)(
      'rejects %s before reading the student',
      async (role) => {
        await expect(
          service.assignGroup(actor(role), 'student-1', {
            groupId: 'group-new',
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(prisma.organization.findUnique).not.toHaveBeenCalled();
        expect(prisma.student.update).not.toHaveBeenCalled();
      },
    );

    it('returns 404 when the student does not exist', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.assignGroup(actor(UserRole.ADMIN), 'missing', {
          groupId: 'group-new',
        }),
      ).rejects.toMatchObject({ message: STUDENT_NOT_FOUND_MESSAGE });
      expect(prisma.student.update).not.toHaveBeenCalled();
    });

    it('returns 404 when the student belongs to another organization', async () => {
      prisma.user.findFirst.mockResolvedValue(assignRow());

      await expect(
        service.assignGroup(actor(UserRole.ADMIN, 'org-2'), 'student-1', {
          groupId: 'group-new',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.student.update).not.toHaveBeenCalled();
    });

    it('returns 404 when the student profile is missing', async () => {
      prisma.user.findFirst.mockResolvedValue(
        assignRow({ studentProfile: null }),
      );

      await expect(
        service.assignGroup(actor(UserRole.ADMIN), 'student-1', {
          groupId: 'group-new',
        }),
      ).rejects.toMatchObject({ message: STUDENT_NOT_FOUND_MESSAGE });
      expect(prisma.group.findUnique).not.toHaveBeenCalled();
    });

    it('returns 404 when the group is missing or belongs to another organization', async () => {
      prisma.group.findUnique.mockResolvedValue({
        id: 'group-new',
        organizationId: 'org-2',
        status: GroupStatus.ACTIVE,
      });

      await expect(
        service.assignGroup(actor(UserRole.OWNER), 'student-1', {
          groupId: 'group-new',
        }),
      ).rejects.toMatchObject({ message: GROUP_NOT_FOUND_MESSAGE });
      expect(prisma.student.update).not.toHaveBeenCalled();
    });

    it.each([GroupStatus.ARCHIVED, GroupStatus.COMPLETED] as const)(
      'rejects a %s group',
      async (status) => {
        prisma.group.findUnique.mockResolvedValue({
          ...targetGroup,
          status,
        });

        await expect(
          service.assignGroup(actor(UserRole.ADMIN), 'student-1', {
            groupId: 'group-new',
          }),
        ).rejects.toMatchObject({ message: GROUP_NOT_ASSIGNABLE_MESSAGE });
        expect(prisma.student.update).not.toHaveBeenCalled();
      },
    );

    it('rejects an archived student', async () => {
      prisma.user.findFirst.mockResolvedValue(
        assignRow({ status: UserStatus.ARCHIVED }),
      );

      await expect(
        service.assignGroup(actor(UserRole.ADMIN), 'student-1', {
          groupId: 'group-new',
        }),
      ).rejects.toMatchObject({ message: STUDENT_TRAINING_STATUS_MESSAGE });
      expect(prisma.student.update).not.toHaveBeenCalled();
    });

    it.each([EnrollmentStatus.DROPPED, EnrollmentStatus.COMPLETED] as const)(
      'rejects a student with a %s enrollment',
      async (status) => {
        prisma.enrollment.findFirst.mockResolvedValue({
          id: 'enr-1',
          status,
          groupId: 'group-old',
          studentId: 'student-1',
        });

        await expect(
          service.assignGroup(actor(UserRole.ADMIN), 'student-1', {
            groupId: 'group-new',
          }),
        ).rejects.toMatchObject({ message: STUDENT_TRAINING_STATUS_MESSAGE });
        expect(prisma.student.update).not.toHaveBeenCalled();
      },
    );

    it('rejects a student who is already in another open group', async () => {
      prisma.user.findFirst.mockResolvedValue(
        assignRow({
          studentProfile: {
            id: 'profile-1',
            userId: 'student-1',
            organizationId: 'org-1',
            groupId: 'group-current',
            instructorId: null,
            carId: null,
          },
        }),
      );
      prisma.group.findUnique.mockImplementation(
        (args: { where: { id: string } }) => {
          if (args.where.id === 'group-current') {
            return Promise.resolve({
              id: 'group-current',
              organizationId: 'org-1',
              status: GroupStatus.ACTIVE,
            });
          }
          return Promise.resolve(targetGroup);
        },
      );

      await expect(
        service.assignGroup(actor(UserRole.ADMIN), 'student-1', {
          groupId: 'group-new',
        }),
      ).rejects.toMatchObject({ message: STUDENT_ACTIVE_GROUP_MESSAGE });
      expect(prisma.student.update).not.toHaveBeenCalled();
    });

    it('rejects a student with an active enrollment in another group', async () => {
      prisma.enrollment.findFirst.mockImplementation(
        (args: { where: { status?: EnrollmentStatus | { in?: unknown } } }) => {
          if (args.where.status === EnrollmentStatus.ACTIVE) {
            return Promise.resolve({
              id: 'enr-active',
              status: EnrollmentStatus.ACTIVE,
              groupId: 'group-current',
              studentId: 'student-1',
            });
          }
          return Promise.resolve(null);
        },
      );

      await expect(
        service.assignGroup(actor(UserRole.ADMIN), 'student-1', {
          groupId: 'group-new',
        }),
      ).rejects.toMatchObject({ message: STUDENT_ACTIVE_GROUP_MESSAGE });
      expect(prisma.student.update).not.toHaveBeenCalled();
    });

    it('moves a student whose current group is already completed', async () => {
      prisma.user.findFirst.mockResolvedValue(
        assignRow({
          studentProfile: {
            id: 'profile-1',
            userId: 'student-1',
            organizationId: 'org-1',
            groupId: 'group-old',
            instructorId: null,
            carId: null,
          },
        }),
      );
      prisma.group.findUnique.mockImplementation(
        (args: { where: { id: string } }) => {
          if (args.where.id === 'group-old') {
            return Promise.resolve({
              id: 'group-old',
              organizationId: 'org-1',
              status: GroupStatus.COMPLETED,
            });
          }
          return Promise.resolve(targetGroup);
        },
      );

      await expect(
        service.assignGroup(actor(UserRole.ADMIN), 'student-1', {
          groupId: 'group-new',
        }),
      ).resolves.toMatchObject({ student: { groupId: 'group-new' } });
    });

    it('rejects a student whose training status is already terminal', async () => {
      prisma.user.findFirst.mockResolvedValue(
        assignRow({
          studentProfile: {
            id: 'profile-1',
            userId: 'student-1',
            organizationId: 'org-1',
            groupId: null,
            instructorId: null,
            carId: null,
            trainingStatus: TrainingStatus.DROPPED,
          },
        }),
      );

      await expect(
        service.assignGroup(actor(UserRole.ADMIN), 'student-1', {
          groupId: 'group-new',
        }),
      ).rejects.toMatchObject({ message: STUDENT_TRAINING_STATUS_MESSAGE });
      expect(prisma.student.update).not.toHaveBeenCalled();
    });
  });

  describe('changeTrainingStatus', () => {
    const profile = {
      id: 'profile-1',
      userId: 'student-1',
      organizationId: 'org-1',
      groupId: null as string | null,
      instructorId: null,
      carId: null,
      trainingStatus: TrainingStatus.ACTIVE,
    };

    function statusRow(trainingStatus: TrainingStatus = TrainingStatus.ACTIVE) {
      return {
        ...studentRow(),
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        studentProfile: { ...profile, trainingStatus },
      };
    }

    beforeEach(() => {
      prisma.user.findFirst.mockResolvedValue(statusRow());
      prisma.student.update.mockImplementation(
        (args: { data: { trainingStatus: TrainingStatus } }) =>
          Promise.resolve({
            ...profile,
            trainingStatus: args.data.trainingStatus,
          }),
      );
      prisma.enrollment.updateMany.mockResolvedValue({ count: 1 });
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('rejects roles other than ADMIN before reading the student', async () => {
      await expect(
        service.changeTrainingStatus(actor(UserRole.OWNER), 'student-1', {
          status: TrainingStatus.GRADUATED,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('stores an allowed transition and returns the current student', async () => {
      const result = await service.changeTrainingStatus(
        actor(UserRole.ADMIN),
        'student-1',
        { status: TrainingStatus.GRADUATED },
      );

      expect(prisma.student.update).toHaveBeenCalledWith({
        where: { id: 'profile-1' },
        data: { trainingStatus: TrainingStatus.GRADUATED },
      });
      expect(prisma.enrollment.updateMany).toHaveBeenCalledWith({
        where: {
          studentId: 'student-1',
          status: EnrollmentStatus.ACTIVE,
          group: { organizationId: 'org-1' },
        },
        data: { status: EnrollmentStatus.COMPLETED },
      });
      expect(result).toMatchObject({
        id: 'student-1',
        role: UserRole.STUDENT,
        status: UserStatus.ACTIVE,
        organizationId: 'org-1',
        student: { trainingStatus: TrainingStatus.GRADUATED },
      });
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        'Student training status changed studentId=student-1 from=ACTIVE to=GRADUATED actorId=admin-1 organizationId=org-1',
      );
    });

    it('closes active enrollments as DROPPED when the student is expelled', async () => {
      await service.changeTrainingStatus(actor(UserRole.ADMIN), 'student-1', {
        status: TrainingStatus.DROPPED,
      });

      expect(prisma.enrollment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: EnrollmentStatus.DROPPED },
        }),
      );
    });

    it('does not touch enrollments when archiving an active student', async () => {
      await service.changeTrainingStatus(actor(UserRole.ADMIN), 'student-1', {
        status: TrainingStatus.ARCHIVED,
      });

      expect(prisma.enrollment.updateMany).not.toHaveBeenCalled();
    });

    it('does not assign PRACTICE through the status endpoint', async () => {
      await expect(
        service.changeTrainingStatus(actor(UserRole.ADMIN), 'student-1', {
          status: TrainingStatus.PRACTICE,
        }),
      ).rejects.toMatchObject({
        message: `${TRAINING_STATUS_TRANSITION_MESSAGE} ACTIVE → PRACTICE.`,
      });
      expect(prisma.student.update).not.toHaveBeenCalled();
    });

    it('rejects a transition that is not allowed', async () => {
      prisma.user.findFirst.mockResolvedValue(
        statusRow(TrainingStatus.GRADUATED),
      );

      await expect(
        service.changeTrainingStatus(actor(UserRole.ADMIN), 'student-1', {
          status: TrainingStatus.ACTIVE,
        }),
      ).rejects.toMatchObject({
        message: `${TRAINING_STATUS_TRANSITION_MESSAGE} GRADUATED → ACTIVE.`,
      });
      expect(prisma.student.update).not.toHaveBeenCalled();
      expect(Logger.prototype.log).not.toHaveBeenCalled();
    });

    it('allows leaving PRACTICE toward graduation', async () => {
      prisma.user.findFirst.mockResolvedValue(
        statusRow(TrainingStatus.PRACTICE),
      );

      await expect(
        service.changeTrainingStatus(actor(UserRole.ADMIN), 'student-1', {
          status: TrainingStatus.GRADUATED,
        }),
      ).resolves.toMatchObject({
        student: { trainingStatus: TrainingStatus.GRADUATED },
      });
    });

    it('does not change a student of another organization', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.changeTrainingStatus(
          actor(UserRole.ADMIN, 'org-2'),
          'student-1',
          {
            status: TrainingStatus.ARCHIVED,
          },
        ),
      ).rejects.toMatchObject({ message: STUDENT_NOT_FOUND_MESSAGE });
      expect(prisma.student.update).not.toHaveBeenCalled();
    });

    it('returns 404 when the organization is deleted', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        ...organization,
        deletedAt: new Date('2026-03-01T00:00:00.000Z'),
      });

      await expect(
        service.changeTrainingStatus(actor(UserRole.ADMIN), 'student-1', {
          status: TrainingStatus.ARCHIVED,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('grantPracticeAccess', () => {
    const instructor = {
      id: 'instructor-1',
      role: UserRole.INSTRUCTOR,
      status: UserStatus.ACTIVE,
      organizationId: 'org-1',
      deletedAt: null as Date | null,
    };
    const car = {
      id: 'car-1',
      organizationId: 'org-1',
      instructorId: 'instructor-1',
      category: LicenseCategory.B,
      transmission: Transmission.MANUAL,
    };
    const payload = { instructorId: 'instructor-1', carId: 'car-1' };
    const profile = {
      id: 'profile-1',
      userId: 'student-1',
      organizationId: 'org-1',
      groupId: null as string | null,
      instructorId: null as string | null,
      carId: null as string | null,
      category: LicenseCategory.B as LicenseCategory | null,
      transmission: Transmission.MANUAL as Transmission | null,
      trainingStatus: TrainingStatus.ACTIVE as TrainingStatus,
    };

    function practiceRow(
      overrides: {
        status?: UserStatus;
        studentProfile?: typeof profile | null;
      } = {},
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

    beforeEach(() => {
      prisma.user.findFirst.mockResolvedValue(practiceRow());
      prisma.user.findUnique.mockResolvedValue(instructor);
      prisma.car.findUnique.mockResolvedValue(car);
      prisma.student.update.mockImplementation(
        (args: {
          data: {
            instructorId: string;
            carId: string;
            trainingStatus: TrainingStatus;
          };
        }) =>
          Promise.resolve({
            ...profile,
            instructorId: args.data.instructorId,
            carId: args.data.carId,
            trainingStatus: args.data.trainingStatus,
          }),
      );
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('assigns the instructor, the car and PRACTICE for ADMIN', async () => {
      const result = await service.grantPracticeAccess(
        actor(UserRole.ADMIN),
        'student-1',
        payload,
      );

      expect(prisma.student.update).toHaveBeenCalledWith({
        where: { id: 'profile-1' },
        data: {
          instructorId: 'instructor-1',
          carId: 'car-1',
          trainingStatus: TrainingStatus.PRACTICE,
        },
      });
      expect(result.student).toMatchObject({
        instructorId: 'instructor-1',
        carId: 'car-1',
        category: LicenseCategory.B,
        transmission: Transmission.MANUAL,
        trainingStatus: TrainingStatus.PRACTICE,
      });
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        'Student practice access granted studentId=student-1 instructorId=instructor-1 carId=car-1 actorId=admin-1 organizationId=org-1',
      );
    });

    it('allows changing instructor and car when the student is already in PRACTICE', async () => {
      prisma.user.findFirst.mockResolvedValue(
        practiceRow({
          studentProfile: {
            ...profile,
            trainingStatus: TrainingStatus.PRACTICE,
            instructorId: 'old-instructor',
            carId: 'old-car',
          },
        }),
      );

      await expect(
        service.grantPracticeAccess(
          actor(UserRole.ADMIN),
          'student-1',
          payload,
        ),
      ).resolves.toMatchObject({
        student: {
          instructorId: 'instructor-1',
          carId: 'car-1',
          trainingStatus: TrainingStatus.PRACTICE,
        },
      });
    });

    it.each([
      UserRole.OWNER,
      UserRole.TEACHER,
      UserRole.INSTRUCTOR,
      UserRole.STUDENT,
    ] as const)('rejects %s before reading the student', async (role) => {
      await expect(
        service.grantPracticeAccess(actor(role), 'student-1', payload),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(prisma.student.update).not.toHaveBeenCalled();
    });

    it('returns 404 when the student does not exist', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.grantPracticeAccess(actor(UserRole.ADMIN), 'missing', payload),
      ).rejects.toMatchObject({ message: STUDENT_NOT_FOUND_MESSAGE });
      expect(prisma.student.update).not.toHaveBeenCalled();
    });

    it('returns 404 for a student of another organization', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.grantPracticeAccess(
          actor(UserRole.ADMIN, 'org-2'),
          'student-1',
          payload,
        ),
      ).rejects.toMatchObject({ message: STUDENT_NOT_FOUND_MESSAGE });
    });

    it.each([
      TrainingStatus.INVITED,
      TrainingStatus.GRADUATED,
      TrainingStatus.DROPPED,
    ])('rejects training status %s', async (trainingStatus) => {
      prisma.user.findFirst.mockResolvedValue(
        practiceRow({
          studentProfile: { ...profile, trainingStatus },
        }),
      );

      await expect(
        service.grantPracticeAccess(
          actor(UserRole.ADMIN),
          'student-1',
          payload,
        ),
      ).rejects.toMatchObject({ message: STUDENT_PRACTICE_ACCESS_MESSAGE });
      expect(prisma.student.update).not.toHaveBeenCalled();
    });

    it('rejects a new practice booking for an archived student', async () => {
      prisma.user.findFirst.mockResolvedValue(
        practiceRow({
          status: UserStatus.ARCHIVED,
          studentProfile: {
            ...profile,
            trainingStatus: TrainingStatus.ARCHIVED,
          },
        }),
      );

      await expect(
        service.grantPracticeAccess(
          actor(UserRole.ADMIN),
          'student-1',
          payload,
        ),
      ).rejects.toMatchObject({ message: ARCHIVED_STUDENT_BOOKING_MESSAGE });
      expect(prisma.student.update).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a blocked account', async () => {
      prisma.user.findFirst.mockResolvedValue(
        practiceRow({ status: UserStatus.BLOCKED }),
      );

      await expect(
        service.grantPracticeAccess(
          actor(UserRole.ADMIN),
          'student-1',
          payload,
        ),
      ).rejects.toMatchObject({ message: STUDENT_PRACTICE_ACCESS_MESSAGE });
    });

    it('rejects a student without category or transmission', async () => {
      prisma.user.findFirst.mockResolvedValue(
        practiceRow({
          studentProfile: { ...profile, category: null, transmission: null },
        }),
      );

      await expect(
        service.grantPracticeAccess(
          actor(UserRole.ADMIN),
          'student-1',
          payload,
        ),
      ).rejects.toMatchObject({ message: STUDENT_PRACTICE_ACCESS_MESSAGE });
    });

    it('returns 404 when the instructor is missing or from another organization', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...instructor,
        organizationId: 'org-2',
      });

      await expect(
        service.grantPracticeAccess(
          actor(UserRole.ADMIN),
          'student-1',
          payload,
        ),
      ).rejects.toMatchObject({ message: INSTRUCTOR_NOT_FOUND_MESSAGE });
      expect(prisma.car.findUnique).not.toHaveBeenCalled();
    });

    it('rejects an instructor whose role is not INSTRUCTOR', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...instructor,
        role: UserRole.TEACHER,
      });

      await expect(
        service.grantPracticeAccess(
          actor(UserRole.ADMIN),
          'student-1',
          payload,
        ),
      ).rejects.toMatchObject({ message: INSTRUCTOR_ROLE_MESSAGE });
    });

    it('rejects an instructor who is not ACTIVE', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...instructor,
        status: UserStatus.BLOCKED,
      });

      await expect(
        service.grantPracticeAccess(
          actor(UserRole.ADMIN),
          'student-1',
          payload,
        ),
      ).rejects.toMatchObject({ message: INSTRUCTOR_NOT_ACTIVE_MESSAGE });
    });

    it('returns 404 when the car is missing or from another organization', async () => {
      prisma.car.findUnique.mockResolvedValue({
        ...car,
        organizationId: 'org-2',
      });

      await expect(
        service.grantPracticeAccess(
          actor(UserRole.ADMIN),
          'student-1',
          payload,
        ),
      ).rejects.toMatchObject({ message: CAR_NOT_FOUND_MESSAGE });
      expect(prisma.student.update).not.toHaveBeenCalled();
    });

    it.each([
      {
        instructorId: 'other-instructor',
        category: LicenseCategory.B,
        transmission: Transmission.MANUAL,
      },
      {
        instructorId: 'instructor-1',
        category: LicenseCategory.C,
        transmission: Transmission.MANUAL,
      },
      {
        instructorId: 'instructor-1',
        category: LicenseCategory.B,
        transmission: Transmission.AUTOMATIC,
      },
    ])('rejects a mismatched instructor and car', async (mismatch) => {
      prisma.car.findUnique.mockResolvedValue({ ...car, ...mismatch });

      await expect(
        service.grantPracticeAccess(
          actor(UserRole.ADMIN),
          'student-1',
          payload,
        ),
      ).rejects.toMatchObject({ message: INSTRUCTOR_CAR_MISMATCH_MESSAGE });
      expect(prisma.student.update).not.toHaveBeenCalled();
    });
  });

  describe('archive', () => {
    const profile = {
      id: 'profile-1',
      userId: 'student-1',
      organizationId: 'org-1',
      groupId: 'group-1' as string | null,
      instructorId: 'instructor-1' as string | null,
      carId: 'car-1' as string | null,
      category: LicenseCategory.B as LicenseCategory | null,
      transmission: Transmission.MANUAL as Transmission | null,
      trainingStatus: TrainingStatus.PRACTICE as TrainingStatus,
    };

    function archiveRow() {
      return {
        ...studentRow(),
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        studentProfile: { ...profile },
      };
    }

    beforeEach(() => {
      prisma.user.findFirst.mockResolvedValue(archiveRow());
      prisma.student.update.mockImplementation(
        (args: { data: { trainingStatus: TrainingStatus } }) =>
          Promise.resolve({
            ...profile,
            trainingStatus: args.data.trainingStatus,
          }),
      );
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it.each([
      UserRole.TEACHER,
      UserRole.INSTRUCTOR,
      UserRole.STUDENT,
    ] as const)('rejects %s before reading the student', async (role) => {
      await expect(
        service.archive(actor(role), 'student-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it.each([UserRole.OWNER, UserRole.ADMIN] as const)(
      'archives the student for %s without deleting history',
      async (role) => {
        const result = await service.archive(actor(role), 'student-1');

        expect(prisma.user.update).toHaveBeenCalledWith({
          where: { id: 'student-1' },
          data: { status: UserStatus.ARCHIVED },
        });
        expect(prisma.student.update).toHaveBeenCalledWith({
          where: { id: 'profile-1' },
          data: { trainingStatus: TrainingStatus.ARCHIVED },
        });
        expect(prisma.user.delete).not.toHaveBeenCalled();
        expect(prisma.student.delete).not.toHaveBeenCalled();
        expect(prisma.enrollment.updateMany).not.toHaveBeenCalled();
        expect(prisma.enrollment.deleteMany).not.toHaveBeenCalled();
        expect(result).toMatchObject({
          id: 'student-1',
          status: UserStatus.ARCHIVED,
          organizationId: 'org-1',
          student: {
            groupId: 'group-1',
            instructorId: 'instructor-1',
            carId: 'car-1',
            trainingStatus: TrainingStatus.ARCHIVED,
          },
        });
        expect(Logger.prototype.log).toHaveBeenCalledWith(
          `Student archived studentId=student-1 actorId=${role.toLowerCase()}-1 organizationId=org-1`,
        );
      },
    );

    it('does not change a student of another organization', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.archive(actor(UserRole.ADMIN, 'org-2'), 'student-1'),
      ).rejects.toMatchObject({ message: STUDENT_NOT_FOUND_MESSAGE });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.student.update).not.toHaveBeenCalled();
    });

    it('returns 404 when the organization is deleted', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        ...organization,
        deletedAt: new Date('2026-03-01T00:00:00.000Z'),
      });

      await expect(
        service.archive(actor(UserRole.ADMIN), 'student-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });
  });
});
