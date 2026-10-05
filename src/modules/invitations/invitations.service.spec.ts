import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  InvitationStatus,
  Prisma,
  TrainingStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { InvitationEmailQueue } from './invitation-email.queue';
import { InvitationTokenErrorCode } from './invitations.dto';
import {
  ADMIN_CANNOT_INVITE_PRIVILEGED_ROLE_MESSAGE,
  CANCELLED_INVITATION_TOKEN_MESSAGE,
  EMAIL_ALREADY_EXISTS_MESSAGE,
  EXPIRED_INVITATION_TOKEN_MESSAGE,
  INVALID_INVITATION_TOKEN_MESSAGE,
  INVITATION_ALREADY_CANCELLED_MESSAGE,
  INVITATION_ALREADY_USED_MESSAGE,
  INVITATION_NOT_FOUND_MESSAGE,
  InvitationsService,
  USED_INVITATION_TOKEN_MESSAGE,
} from './invitations.service';

function uniqueConstraintError(field: string) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.9.1',
    meta: { target: [field] },
  });
}

describe('InvitationsService', () => {
  let service: InvitationsService;
  let tx: {
    user: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    invitation: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    student: { findUnique: jest.Mock; create: jest.Mock };
  };

  const owner = {
    id: 'owner-1',
    firstName: 'Іван',
    lastName: 'Петренко',
    role: UserRole.OWNER,
    organizationId: 'org-1',
  };

  const admin = {
    id: 'admin-inviter-1',
    firstName: 'Марія',
    lastName: 'Іваненко',
    role: UserRole.ADMIN,
    organizationId: 'org-1',
  };

  const payload = {
    firstName: ' Олена ',
    lastName: 'Коваль',
    email: 'Admin@Example.com ',
    phone: ' +380991234567 ',
  };

  const memberPayload = {
    firstName: ' Олена ',
    lastName: 'Коваль',
    email: 'Teacher@Example.com ',
    phone: ' +380991234567 ',
    role: UserRole.TEACHER,
  };

  const createdUser = {
    id: 'admin-1',
    firstName: 'Олена',
    lastName: 'Коваль',
    email: 'admin@example.com',
    phone: '+380991234567',
    role: UserRole.ADMIN,
    status: UserStatus.INVITED,
    organizationId: 'org-1',
  };

  const createdTeacher = {
    ...createdUser,
    id: 'teacher-1',
    email: 'teacher@example.com',
    role: UserRole.TEACHER,
  };

  const createdInvitation = {
    id: 'invite-1',
    email: 'admin@example.com',
    role: UserRole.ADMIN,
    status: InvitationStatus.PENDING,
    expiresAt: new Date('2026-09-20T12:00:00.000Z'),
    userId: 'admin-1',
    organizationId: 'org-1',
    tokenHash: 'hashed',
  };

  const createdTeacherInvitation = {
    ...createdInvitation,
    id: 'invite-teacher-1',
    email: 'teacher@example.com',
    role: UserRole.TEACHER,
    userId: 'teacher-1',
  };

  const prisma = {
    organization: { findUnique: jest.fn() },
    user: { delete: jest.fn(), update: jest.fn() },
    invitation: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    invitationEmailJob: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn(),
  };
  const queuedAt = new Date('2026-10-05T10:00:00.000Z');
  const queuedDelivery = {
    status: 'QUEUED' as const,
    attempts: 0,
    lastError: null,
    sentAt: null,
    queuedAt,
  };
  const noneDelivery = {
    status: 'NONE' as const,
    attempts: 0,
    lastError: null,
    sentAt: null,
    queuedAt: null,
  };
  const emailQueue = {
    enqueue: jest.fn().mockResolvedValue(queuedDelivery),
    replacePending: jest.fn().mockResolvedValue(queuedDelivery),
    kick: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      name: 'Автошкола Drive',
      deletedAt: null,
    });
    emailQueue.enqueue.mockResolvedValue(queuedDelivery);
    emailQueue.replacePending.mockResolvedValue(queuedDelivery);
    prisma.user.delete.mockResolvedValue(createdUser);
    prisma.user.update.mockResolvedValue(createdUser);
    prisma.invitation.delete.mockResolvedValue(createdInvitation);

    tx = {
      user: {
        create: jest.fn().mockResolvedValue(createdUser),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      invitation: {
        create: jest.fn().mockResolvedValue(createdInvitation),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(createdInvitation),
      },
      student: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'profile-1' }),
      },
    };
    prisma.$transaction.mockImplementation((cb: (client: unknown) => unknown) =>
      cb(tx),
    );

    service = new InvitationsService(
      prisma as unknown as PrismaService,
      emailQueue as unknown as InvitationEmailQueue,
    );
  });

  it('creates an INVITED ADMIN and a pending invitation linked to the school', async () => {
    const result = await service.inviteAdmin(owner as never, payload);

    expect(tx.user.create).toHaveBeenCalledWith({
      data: {
        email: 'admin@example.com',
        firstName: 'Олена',
        lastName: 'Коваль',
        phone: '+380991234567',
        passwordHash: null,
        role: UserRole.ADMIN,
        status: UserStatus.INVITED,
        organizationId: 'org-1',
      },
    });
    expect(tx.invitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'admin@example.com',
        role: UserRole.ADMIN,
        status: InvitationStatus.PENDING,
        invitedById: 'owner-1',
        userId: 'admin-1',
        organizationId: 'org-1',
      }),
    });

    expect(result.user).toEqual({
      id: 'admin-1',
      firstName: 'Олена',
      lastName: 'Коваль',
      email: 'admin@example.com',
      phone: '+380991234567',
      role: UserRole.ADMIN,
      status: UserStatus.INVITED,
      organizationId: 'org-1',
    });
    expect(result.invitation).toEqual({
      id: 'invite-1',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
      status: InvitationStatus.PENDING,
      expiresAt: createdInvitation.expiresAt,
      userId: 'admin-1',
      organizationId: 'org-1',
      emailDelivery: queuedDelivery,
    });
    expect(result).not.toHaveProperty('token');
    expect(JSON.stringify(result)).not.toContain('tokenHash');
  });

  it('creates an INVITED STUDENT when the owner passes role', async () => {
    const student = { ...createdUser, role: UserRole.STUDENT };
    tx.user.create.mockResolvedValue(student);

    const result = await service.inviteAdmin(owner as never, {
      ...payload,
      role: UserRole.STUDENT,
    });

    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ role: UserRole.STUDENT }),
    });
    expect(tx.student.create).toHaveBeenCalledWith({
      data: {
        userId: 'admin-1',
        organizationId: 'org-1',
        instructorId: null,
        carId: null,
        trainingStatus: TrainingStatus.INVITED,
      },
    });
    expect(result.user.role).toBe(UserRole.STUDENT);
  });

  it('rejects an invitation with role OWNER', async () => {
    await expect(
      service.inviteAdmin(owner as never, {
        ...payload,
        role: UserRole.OWNER,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('stores a hash of the invitation token and queues the raw token', async () => {
    const result = await service.inviteAdmin(owner as never, payload);

    const enqueued = emailQueue.enqueue.mock.calls[0][1] as {
      token: string;
      tokenHash: string;
    };
    expect(enqueued.token.length).toBeGreaterThan(20);
    expect(enqueued.tokenHash).toBe(
      createHash('sha256').update(enqueued.token).digest('hex'),
    );
    expect(tx.invitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tokenHash: enqueued.tokenHash,
      }),
    });
    expect(emailQueue.kick).toHaveBeenCalled();
    expect(result).not.toHaveProperty('token');
    expect(JSON.stringify(result)).not.toContain(enqueued.token);
  });

  it('rejects a duplicate email with ConflictException', async () => {
    prisma.$transaction.mockRejectedValue(uniqueConstraintError('email'));

    await expect(
      service.inviteAdmin(owner as never, payload),
    ).rejects.toMatchObject({
      response: {
        statusCode: 409,
        errors: [{ field: 'email', message: EMAIL_ALREADY_EXISTS_MESSAGE }],
      },
    });
    expect(emailQueue.enqueue).not.toHaveBeenCalled();
    expect(emailQueue.replacePending).not.toHaveBeenCalled();
  });

  it('issues a new invitation when the previous one expired or was cancelled', async () => {
    const invitedUser = {
      id: 'admin-1',
      firstName: 'Стара',
      lastName: 'Версія',
      email: 'admin@example.com',
      phone: null,
      passwordHash: null,
      role: UserRole.ADMIN,
      status: UserStatus.INVITED,
      organizationId: 'org-1',
      deletedAt: null,
    };
    tx.user.findUnique.mockResolvedValue(invitedUser);
    tx.user.update.mockResolvedValue(createdUser);

    const result = await service.inviteAdmin(owner as never, payload);

    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.invitation.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'admin-1',
        status: InvitationStatus.PENDING,
        acceptedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'admin-1' },
      data: {
        firstName: 'Олена',
        lastName: 'Коваль',
        phone: '+380991234567',
        role: UserRole.ADMIN,
        status: UserStatus.INVITED,
        passwordHash: null,
      },
    });
    expect(tx.invitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'admin@example.com',
        role: UserRole.ADMIN,
        status: InvitationStatus.PENDING,
        userId: 'admin-1',
        invitedById: 'owner-1',
      }),
    });
    expect(result.invitation.status).toBe(InvitationStatus.PENDING);
    expect(emailQueue.enqueue).toHaveBeenCalled();
    expect(emailQueue.kick).toHaveBeenCalled();
  });

  it('refreshes a live pending invitation and queues another email', async () => {
    tx.user.findUnique.mockResolvedValue({
      id: 'admin-1',
      status: UserStatus.INVITED,
      organizationId: 'org-1',
      deletedAt: null,
    });
    tx.invitation.findFirst.mockResolvedValue({ id: 'live-invite' });
    tx.user.update.mockResolvedValue(createdUser);
    tx.invitation.update.mockResolvedValue({
      ...createdInvitation,
      id: 'live-invite',
    });

    const result = await service.inviteAdmin(owner as never, payload);

    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.invitation.create).not.toHaveBeenCalled();
    expect(tx.invitation.update).toHaveBeenCalledWith({
      where: { id: 'live-invite' },
      data: expect.objectContaining({
        email: 'admin@example.com',
        role: UserRole.ADMIN,
        status: InvitationStatus.PENDING,
        invitedById: 'owner-1',
      }),
    });
    expect(emailQueue.replacePending).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ invitationId: 'live-invite' }),
    );
    expect(emailQueue.kick).toHaveBeenCalled();
    expect(result.invitation).toMatchObject({
      id: 'live-invite',
      status: InvitationStatus.PENDING,
      emailDelivery: queuedDelivery,
    });
    expect(result).not.toHaveProperty('token');
  });

  it('rejects a repeat invite when the account is already active', async () => {
    tx.user.findUnique.mockResolvedValue({
      id: 'admin-1',
      status: UserStatus.ACTIVE,
      organizationId: 'org-1',
      deletedAt: null,
    });

    await expect(
      service.inviteAdmin(owner as never, payload),
    ).rejects.toMatchObject({
      response: {
        statusCode: 409,
        errors: [{ field: 'email', message: EMAIL_ALREADY_EXISTS_MESSAGE }],
      },
    });
    expect(tx.invitation.create).not.toHaveBeenCalled();
    expect(emailQueue.enqueue).not.toHaveBeenCalled();
    expect(emailQueue.replacePending).not.toHaveBeenCalled();
  });

  it('rejects when the owner organization is missing', async () => {
    prisma.organization.findUnique.mockResolvedValue(null);

    await expect(
      service.inviteAdmin(owner as never, payload),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('keeps the invited user when the email is queued', async () => {
    const result = await service.inviteAdmin(owner as never, payload);

    expect(emailQueue.enqueue).toHaveBeenCalled();
    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect(result.invitation.emailDelivery).toEqual(queuedDelivery);
  });

  describe('inviteMember', () => {
    beforeEach(() => {
      tx.user.create.mockResolvedValue(createdTeacher);
      tx.invitation.create.mockResolvedValue(createdTeacherInvitation);
      prisma.user.delete.mockResolvedValue(createdTeacher);
    });

    it.each([UserRole.TEACHER, UserRole.INSTRUCTOR, UserRole.STUDENT])(
      'creates an INVITED %s and queues a hashed invitation token',
      async (role) => {
        const createdMember = { ...createdTeacher, role };
        const createdMemberInvitation = {
          ...createdTeacherInvitation,
          role,
        };
        tx.user.create.mockResolvedValue(createdMember);
        tx.invitation.create.mockResolvedValue(createdMemberInvitation);

        const result = await service.inviteMember(admin as never, {
          ...memberPayload,
          role,
        });

        expect(tx.user.create).toHaveBeenCalledWith({
          data: {
            email: 'teacher@example.com',
            firstName: 'Олена',
            lastName: 'Коваль',
            phone: '+380991234567',
            passwordHash: null,
            role,
            status: UserStatus.INVITED,
            organizationId: 'org-1',
          },
        });
        expect(tx.invitation.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            email: 'teacher@example.com',
            role,
            status: InvitationStatus.PENDING,
            invitedById: 'admin-inviter-1',
            userId: 'teacher-1',
            organizationId: 'org-1',
          }),
        });
        expect(result.user).toMatchObject({
          role,
          status: UserStatus.INVITED,
        });
        expect(result.invitation).toMatchObject({
          role,
          status: InvitationStatus.PENDING,
        });
        expect(result).not.toHaveProperty('token');
        expect(JSON.stringify(result)).not.toContain('tokenHash');
        if (role === UserRole.STUDENT) {
          expect(tx.student.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
              userId: 'teacher-1',
              organizationId: 'org-1',
              trainingStatus: TrainingStatus.INVITED,
            }),
          });
        } else {
          expect(tx.student.create).not.toHaveBeenCalled();
        }

        const enqueued = emailQueue.enqueue.mock.calls[0][1] as {
          token: string;
          tokenHash: string;
        };
        expect(enqueued.tokenHash).toBe(
          createHash('sha256').update(enqueued.token).digest('hex'),
        );
        expect(tx.invitation.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            tokenHash: enqueued.tokenHash,
          }),
        });
        expect(emailQueue.kick).toHaveBeenCalled();
        expect(JSON.stringify(result)).not.toContain(enqueued.token);
      },
    );

    it.each([UserRole.OWNER, UserRole.ADMIN])(
      'rejects inviting %s',
      async (role) => {
        await expect(
          service.inviteMember(admin as never, { ...memberPayload, role }),
        ).rejects.toMatchObject({
          message: ADMIN_CANNOT_INVITE_PRIVILEGED_ROLE_MESSAGE,
        });
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(emailQueue.enqueue).not.toHaveBeenCalled();
      },
    );

    it('rejects when the inviter is not ADMIN', async () => {
      await expect(
        service.inviteMember(owner as never, memberPayload),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a duplicate email with ConflictException', async () => {
      prisma.$transaction.mockRejectedValue(uniqueConstraintError('email'));

      await expect(
        service.inviteMember(admin as never, memberPayload),
      ).rejects.toMatchObject({
        response: {
          statusCode: 409,
          errors: [{ field: 'email', message: EMAIL_ALREADY_EXISTS_MESSAGE }],
        },
      });
      expect(emailQueue.enqueue).not.toHaveBeenCalled();
    });

    it('rejects when the admin organization is missing', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.inviteMember(admin as never, memberPayload),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('queues the member invitation instead of deleting the user', async () => {
      const result = await service.inviteMember(admin as never, memberPayload);

      expect(emailQueue.enqueue).toHaveBeenCalled();
      expect(prisma.user.delete).not.toHaveBeenCalled();
      expect(result.invitation.emailDelivery).toEqual(queuedDelivery);
    });
  });

  describe('verifyToken', () => {
    const rawToken = 'valid-invitation-token';
    const pendingInvitation = {
      id: 'invite-1',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
      status: InvitationStatus.PENDING,
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      userId: 'admin-1',
      organizationId: 'org-1',
      tokenHash: createHash('sha256').update(rawToken).digest('hex'),
      user: {
        firstName: 'Олена',
        lastName: 'Коваль',
        status: UserStatus.INVITED,
      },
      organization: {
        name: 'Автошкола Drive',
      },
    };

    it('accepts a valid pending invitation token', async () => {
      prisma.invitation.findUnique.mockResolvedValue(pendingInvitation);

      await expect(service.verifyToken(` ${rawToken} `)).resolves.toEqual({
        valid: true,
        email: 'admin@example.com',
        firstName: 'Олена',
        lastName: 'Коваль',
        role: UserRole.ADMIN,
        status: InvitationStatus.PENDING,
        expiresAt: pendingInvitation.expiresAt,
        organizationName: 'Автошкола Drive',
        organizationId: 'org-1',
      });
      expect(prisma.invitation.findUnique).toHaveBeenCalledWith({
        where: {
          tokenHash: createHash('sha256').update(rawToken).digest('hex'),
        },
        include: { user: true, organization: true },
      });
    });

    it('rejects an unknown token', async () => {
      prisma.invitation.findUnique.mockResolvedValue(null);

      await expect(service.verifyToken('unknown-token')).rejects.toMatchObject({
        response: {
          statusCode: 400,
          code: InvitationTokenErrorCode.INVALID,
          message: INVALID_INVITATION_TOKEN_MESSAGE,
        },
      });
    });

    it('rejects an expired pending token', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        ...pendingInvitation,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.verifyToken(rawToken)).rejects.toMatchObject({
        response: {
          statusCode: 400,
          code: InvitationTokenErrorCode.EXPIRED,
          message: EXPIRED_INVITATION_TOKEN_MESSAGE,
        },
      });
    });

    it('rejects a cancelled invitation token', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        ...pendingInvitation,
        status: InvitationStatus.CANCELLED,
      });

      await expect(service.verifyToken(rawToken)).rejects.toMatchObject({
        response: {
          statusCode: 400,
          code: InvitationTokenErrorCode.CANCELLED,
          message: CANCELLED_INVITATION_TOKEN_MESSAGE,
        },
      });
    });

    it('rejects an already accepted invitation token', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        ...pendingInvitation,
        status: InvitationStatus.ACCEPTED,
        acceptedAt: new Date(),
      });

      await expect(service.verifyToken(rawToken)).rejects.toMatchObject({
        response: {
          statusCode: 400,
          code: InvitationTokenErrorCode.USED,
          message: USED_INVITATION_TOKEN_MESSAGE,
        },
      });
    });

    it('rejects a token after the invited user was already activated', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        ...pendingInvitation,
        user: {
          ...pendingInvitation.user,
          status: UserStatus.ACTIVE,
        },
      });

      await expect(service.verifyToken(rawToken)).rejects.toMatchObject({
        response: {
          statusCode: 400,
          code: InvitationTokenErrorCode.USED,
          message: USED_INVITATION_TOKEN_MESSAGE,
        },
      });
    });

    it('does not consume the token while verifying it', async () => {
      prisma.invitation.findUnique.mockResolvedValue(pendingInvitation);

      await service.verifyToken(rawToken);
      await service.verifyToken(rawToken);

      expect(prisma.invitation.findUnique).toHaveBeenCalledTimes(2);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('activate', () => {
    const rawToken = 'valid-invitation-token';
    const password = 'SecurePassword123!';
    const pendingInvitation = {
      id: 'invite-1',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
      status: InvitationStatus.PENDING,
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      userId: 'admin-1',
      organizationId: 'org-1',
      tokenHash: createHash('sha256').update(rawToken).digest('hex'),
      user: {
        id: 'admin-1',
        firstName: 'Олена',
        lastName: 'Коваль',
        email: 'admin@example.com',
        phone: '+380991234567',
        status: UserStatus.INVITED,
        deletedAt: null,
      },
      organization: {
        name: 'Автошкола Drive',
        deletedAt: null,
      },
    };
    const activatedUser = {
      id: 'admin-1',
      firstName: 'Олена',
      lastName: 'Коваль',
      email: 'admin@example.com',
      phone: '+380991234567',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      organizationId: 'org-1',
    };

    let activateTx: {
      invitation: {
        findUnique: jest.Mock;
        updateMany: jest.Mock;
      };
      user: {
        updateMany: jest.Mock;
        findUniqueOrThrow: jest.Mock;
      };
    };

    beforeEach(() => {
      activateTx = {
        invitation: {
          findUnique: jest.fn().mockResolvedValue(pendingInvitation),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        user: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: jest.fn().mockResolvedValue(activatedUser),
        },
      };
      prisma.invitation.findUnique.mockResolvedValue(pendingInvitation);
      prisma.$transaction.mockImplementation(
        (cb: (client: typeof activateTx) => unknown) => cb(activateTx),
      );
    });

    it('sets the password, activates the user and accepts the invitation', async () => {
      const result = await service.activate(` ${rawToken} `, password);

      expect(prisma.invitation.findUnique).toHaveBeenCalledWith({
        where: {
          tokenHash: createHash('sha256').update(rawToken).digest('hex'),
        },
        include: { user: true, organization: true },
      });
      expect(activateTx.invitation.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'invite-1',
          status: InvitationStatus.PENDING,
          acceptedAt: null,
        },
        data: {
          status: InvitationStatus.ACCEPTED,
          acceptedAt: expect.any(Date),
        },
      });

      const userWrite = activateTx.user.updateMany.mock.calls[0][0] as {
        where: { id: string; status: UserStatus; deletedAt: null };
        data: { passwordHash: string; status: UserStatus };
      };
      expect(userWrite.where).toEqual({
        id: 'admin-1',
        status: UserStatus.INVITED,
        deletedAt: null,
      });
      expect(userWrite.data.status).toBe(UserStatus.ACTIVE);
      expect(userWrite.data.passwordHash).not.toBe(password);
      await expect(
        bcrypt.compare(password, userWrite.data.passwordHash),
      ).resolves.toBe(true);

      expect(result.user).toEqual(activatedUser);
      expect(result.invitation).toEqual({
        id: 'invite-1',
        email: 'admin@example.com',
        role: UserRole.ADMIN,
        status: InvitationStatus.ACCEPTED,
        acceptedAt: expect.any(Date),
        userId: 'admin-1',
        organizationId: 'org-1',
      });
      expect(JSON.stringify(result)).not.toContain(password);
      expect(JSON.stringify(result)).not.toContain('tokenHash');
    });

    it('rejects an unknown token without changing the account', async () => {
      prisma.invitation.findUnique.mockResolvedValue(null);

      await expect(service.activate(rawToken, password)).rejects.toMatchObject({
        response: {
          statusCode: 400,
          code: InvitationTokenErrorCode.INVALID,
          message: INVALID_INVITATION_TOKEN_MESSAGE,
        },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an expired invitation', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        ...pendingInvitation,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.activate(rawToken, password)).rejects.toMatchObject({
        response: {
          statusCode: 400,
          code: InvitationTokenErrorCode.EXPIRED,
          message: EXPIRED_INVITATION_TOKEN_MESSAGE,
        },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an already accepted invitation', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        ...pendingInvitation,
        status: InvitationStatus.ACCEPTED,
        acceptedAt: new Date(),
      });

      await expect(service.activate(rawToken, password)).rejects.toMatchObject({
        response: {
          statusCode: 400,
          code: InvitationTokenErrorCode.USED,
          message: USED_INVITATION_TOKEN_MESSAGE,
        },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a cancelled invitation', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        ...pendingInvitation,
        status: InvitationStatus.CANCELLED,
      });

      await expect(service.activate(rawToken, password)).rejects.toMatchObject({
        response: {
          statusCode: 400,
          code: InvitationTokenErrorCode.CANCELLED,
          message: CANCELLED_INVITATION_TOKEN_MESSAGE,
        },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects activation when the invited user is no longer INVITED', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        ...pendingInvitation,
        user: {
          ...pendingInvitation.user,
          status: UserStatus.ACTIVE,
        },
      });

      await expect(service.activate(rawToken, password)).rejects.toMatchObject({
        response: {
          statusCode: 400,
          code: InvitationTokenErrorCode.USED,
          message: USED_INVITATION_TOKEN_MESSAGE,
        },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a deleted invited user', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        ...pendingInvitation,
        user: {
          ...pendingInvitation.user,
          deletedAt: new Date(),
        },
      });

      await expect(service.activate(rawToken, password)).rejects.toMatchObject({
        response: {
          statusCode: 400,
          code: InvitationTokenErrorCode.INVALID,
          message: INVALID_INVITATION_TOKEN_MESSAGE,
        },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does not set a password when the invitation was consumed concurrently', async () => {
      activateTx.invitation.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.activate(rawToken, password)).rejects.toMatchObject({
        response: {
          statusCode: 400,
          code: InvitationTokenErrorCode.USED,
          message: USED_INVITATION_TOKEN_MESSAGE,
        },
      });
      expect(activateTx.user.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('list, getById and cancel', () => {
    const pendingAdminInvitation = {
      id: 'invite-1',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
      status: InvitationStatus.PENDING,
      expiresAt: new Date('2026-10-01T00:00:00.000Z'),
      acceptedAt: null as Date | null,
      userId: 'admin-1',
      organizationId: 'org-1',
      user: {
        status: UserStatus.INVITED,
        deletedAt: null as Date | null,
      },
    };

    const pendingTeacherInvitation = {
      ...pendingAdminInvitation,
      id: 'invite-teacher-1',
      email: 'teacher@example.com',
      role: UserRole.TEACHER,
      userId: 'teacher-1',
    };

    it('lists every school invitation for OWNER and only member invitations for ADMIN', async () => {
      prisma.invitation.findMany.mockResolvedValue([pendingAdminInvitation]);

      await service.list(owner as never);

      expect(prisma.invitation.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          role: {
            in: [
              UserRole.ADMIN,
              UserRole.TEACHER,
              UserRole.INSTRUCTOR,
              UserRole.STUDENT,
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
        include: {
          emailJobs: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              status: true,
              attempts: true,
              lastError: true,
              sentAt: true,
              createdAt: true,
            },
          },
        },
      });

      prisma.invitation.findMany.mockResolvedValue([pendingTeacherInvitation]);
      const adminList = await service.list(admin as never);

      expect(prisma.invitation.findMany).toHaveBeenLastCalledWith({
        where: {
          organizationId: 'org-1',
          role: {
            in: [UserRole.TEACHER, UserRole.INSTRUCTOR, UserRole.STUDENT],
          },
        },
        orderBy: { createdAt: 'desc' },
        include: {
          emailJobs: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              status: true,
              attempts: true,
              lastError: true,
              sentAt: true,
              createdAt: true,
            },
          },
        },
      });
      expect(adminList.invitations).toEqual([
        {
          id: 'invite-teacher-1',
          email: 'teacher@example.com',
          role: UserRole.TEACHER,
          status: InvitationStatus.PENDING,
          expiresAt: pendingTeacherInvitation.expiresAt,
          userId: 'teacher-1',
          organizationId: 'org-1',
          emailDelivery: noneDelivery,
        },
      ]);
    });

    it('returns one invitation by id and hides invitations from another school', async () => {
      prisma.invitation.findUnique.mockResolvedValue(pendingTeacherInvitation);

      await expect(
        service.getById(admin as never, 'invite-teacher-1'),
      ).resolves.toMatchObject({
        id: 'invite-teacher-1',
        role: UserRole.TEACHER,
      });

      prisma.invitation.findUnique.mockResolvedValue({
        ...pendingTeacherInvitation,
        organizationId: 'org-2',
      });
      await expect(
        service.getById(admin as never, 'invite-teacher-1'),
      ).rejects.toMatchObject({
        message: INVITATION_NOT_FOUND_MESSAGE,
      });
    });

    it('lets OWNER cancel a pending ADMIN invitation', async () => {
      prisma.invitation.findUnique.mockResolvedValue(pendingAdminInvitation);
      prisma.invitation.update.mockResolvedValue({
        ...pendingAdminInvitation,
        status: InvitationStatus.CANCELLED,
      });

      await expect(
        service.cancel(owner as never, 'invite-1'),
      ).resolves.toMatchObject({
        id: 'invite-1',
        status: InvitationStatus.CANCELLED,
      });
      expect(prisma.invitation.update).toHaveBeenCalledWith({
        where: { id: 'invite-1' },
        data: { status: InvitationStatus.CANCELLED },
      });
      expect(prisma.invitationEmailJob.updateMany).toHaveBeenCalledWith({
        where: {
          invitationId: 'invite-1',
          status: { in: ['QUEUED', 'PROCESSING', 'FAILED'] },
        },
        data: { status: 'SUPERSEDED', token: null },
      });
    });

    it('lets ADMIN cancel a member invitation and forbids cancelling an ADMIN invitation', async () => {
      prisma.invitation.findUnique.mockResolvedValue(pendingTeacherInvitation);
      prisma.invitation.update.mockResolvedValue({
        ...pendingTeacherInvitation,
        status: InvitationStatus.CANCELLED,
      });

      await expect(
        service.cancel(admin as never, 'invite-teacher-1'),
      ).resolves.toMatchObject({ status: InvitationStatus.CANCELLED });

      prisma.invitation.findUnique.mockResolvedValue(pendingAdminInvitation);
      await expect(
        service.cancel(admin as never, 'invite-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a second cancel and an already accepted invitation', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        ...pendingAdminInvitation,
        status: InvitationStatus.CANCELLED,
      });
      await expect(
        service.cancel(owner as never, 'invite-1'),
      ).rejects.toMatchObject({
        response: {
          statusCode: 400,
          message: INVITATION_ALREADY_CANCELLED_MESSAGE,
        },
      });

      prisma.invitation.findUnique.mockResolvedValue({
        ...pendingAdminInvitation,
        status: InvitationStatus.ACCEPTED,
        acceptedAt: new Date(),
      });
      await expect(
        service.cancel(owner as never, 'invite-1'),
      ).rejects.toMatchObject({
        response: {
          statusCode: 400,
          message: INVITATION_ALREADY_USED_MESSAGE,
        },
      });
      expect(prisma.invitation.update).not.toHaveBeenCalled();
    });
  });

  describe('resend', () => {
    const pending = {
      id: 'invite-1',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
      status: InvitationStatus.PENDING,
      expiresAt: new Date('2026-10-01T00:00:00.000Z'),
      acceptedAt: null as Date | null,
      userId: 'admin-1',
      organizationId: 'org-1',
      user: {
        status: UserStatus.INVITED,
        deletedAt: null as Date | null,
      },
    };

    it('rotates the token and queues a new email for a pending invitation', async () => {
      prisma.invitation.findUnique.mockResolvedValue(pending);
      tx.invitation.update.mockImplementation(
        (args: { data: { tokenHash: string; expiresAt: Date } }) =>
          Promise.resolve({
            ...createdInvitation,
            tokenHash: args.data.tokenHash,
            expiresAt: args.data.expiresAt,
          }),
      );

      const result = await service.resend(owner as never, 'invite-1');
      const queued = emailQueue.replacePending.mock.calls[0][1] as {
        token: string;
        tokenHash: string;
        invitationId: string;
      };

      expect(queued.invitationId).toBe('invite-1');
      expect(queued.tokenHash).toBe(
        createHash('sha256').update(queued.token).digest('hex'),
      );
      expect(tx.invitation.update).toHaveBeenCalledWith({
        where: { id: 'invite-1' },
        data: expect.objectContaining({
          tokenHash: queued.tokenHash,
          status: InvitationStatus.PENDING,
          acceptedAt: null,
        }),
      });
      expect(emailQueue.kick).toHaveBeenCalled();
      expect(result.emailDelivery).toEqual(queuedDelivery);
      expect(JSON.stringify(result)).not.toContain(queued.token);
    });

    it('rejects a cancelled invitation', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        ...pending,
        status: InvitationStatus.CANCELLED,
      });

      await expect(
        service.resend(owner as never, 'invite-1'),
      ).rejects.toMatchObject({
        response: {
          statusCode: 400,
          message: INVITATION_ALREADY_CANCELLED_MESSAGE,
        },
      });
      expect(emailQueue.replacePending).not.toHaveBeenCalled();
    });

    it('rejects an invitation that was already accepted', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        ...pending,
        status: InvitationStatus.ACCEPTED,
        acceptedAt: new Date(),
      });

      await expect(
        service.resend(owner as never, 'invite-1'),
      ).rejects.toMatchObject({
        response: {
          statusCode: 400,
          message: INVITATION_ALREADY_USED_MESSAGE,
        },
      });
    });

    it('forbids an admin from resending an admin invitation', async () => {
      prisma.invitation.findUnique.mockResolvedValue(pending);

      await expect(
        service.resend(admin as never, 'invite-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
