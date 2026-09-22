import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InvitationStatus, Prisma, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { InvitationTokenErrorCode } from './invitations.dto';
import {
  ADMIN_CANNOT_INVITE_PRIVILEGED_ROLE_MESSAGE,
  EMAIL_ALREADY_EXISTS_MESSAGE,
  EXPIRED_INVITATION_TOKEN_MESSAGE,
  INVALID_INVITATION_TOKEN_MESSAGE,
  invitationAcceptUrl,
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
    user: { create: jest.Mock };
    invitation: { create: jest.Mock };
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
    user: { delete: jest.fn() },
    invitation: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const mailService = {
    sendEmail: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      name: 'Автошкола Drive',
      deletedAt: null,
    });
    mailService.sendEmail.mockResolvedValue(undefined);
    prisma.user.delete.mockResolvedValue(createdUser);

    tx = {
      user: { create: jest.fn().mockResolvedValue(createdUser) },
      invitation: { create: jest.fn().mockResolvedValue(createdInvitation) },
    };
    prisma.$transaction.mockImplementation((cb: (client: unknown) => unknown) =>
      cb(tx),
    );

    service = new InvitationsService(
      prisma as unknown as PrismaService,
      mailService as unknown as MailService,
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
    });
    expect(result).not.toHaveProperty('token');
    expect(JSON.stringify(result)).not.toContain('tokenHash');
  });

  it('stores a hash of the invitation token and emails the raw token', async () => {
    await service.inviteAdmin(owner as never, payload);

    const html = mailService.sendEmail.mock.calls[0][0].html as string;
    const tokenMatch = html.match(/invite\?token=([^"&\s<]+)/);
    if (!tokenMatch?.[1]) {
      throw new Error('invitation email did not contain a token');
    }
    const token = decodeURIComponent(tokenMatch[1]);
    expect(token.length).toBeGreaterThan(20);

    expect(tx.invitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tokenHash: createHash('sha256').update(token).digest('hex'),
      }),
    });
    expect(mailService.sendEmail).toHaveBeenCalledWith({
      to: 'admin@example.com',
      subject: 'Запрошення стати адміністратором — Автошкола Drive',
      html: expect.stringContaining(invitationAcceptUrl(token)),
    });
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
    expect(mailService.sendEmail).not.toHaveBeenCalled();
  });

  it('rejects when the owner organization is missing', async () => {
    prisma.organization.findUnique.mockResolvedValue(null);

    await expect(
      service.inviteAdmin(owner as never, payload),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('deletes the created admin if the invitation email cannot be sent', async () => {
    mailService.sendEmail.mockRejectedValue(
      new InternalServerErrorException('Failed to send email'),
    );

    await expect(
      service.inviteAdmin(owner as never, payload),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(prisma.user.delete).toHaveBeenCalledWith({
      where: { id: 'admin-1' },
    });
  });

  describe('inviteMember', () => {
    beforeEach(() => {
      tx.user.create.mockResolvedValue(createdTeacher);
      tx.invitation.create.mockResolvedValue(createdTeacherInvitation);
      prisma.user.delete.mockResolvedValue(createdTeacher);
    });

    it.each([
      [UserRole.TEACHER, 'викладачем'],
      [UserRole.INSTRUCTOR, 'інструктором'],
      [UserRole.STUDENT, 'учнем'],
    ] as const)(
      'creates an INVITED %s and emails a hashed invitation token',
      async (role, roleTitle) => {
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

        const html = mailService.sendEmail.mock.calls[0][0].html as string;
        const tokenMatch = html.match(/invite\?token=([^"&\s<]+)/);
        if (!tokenMatch?.[1]) {
          throw new Error('invitation email did not contain a token');
        }
        const token = decodeURIComponent(tokenMatch[1]);
        expect(tx.invitation.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            tokenHash: createHash('sha256').update(token).digest('hex'),
          }),
        });
        expect(mailService.sendEmail).toHaveBeenCalledWith({
          to: 'teacher@example.com',
          subject: `Запрошення стати ${roleTitle} — Автошкола Drive`,
          html: expect.stringContaining(invitationAcceptUrl(token)),
        });
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
        expect(mailService.sendEmail).not.toHaveBeenCalled();
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
      expect(mailService.sendEmail).not.toHaveBeenCalled();
    });

    it('rejects when the admin organization is missing', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.inviteMember(admin as never, memberPayload),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('deletes the created member if the invitation email cannot be sent', async () => {
      mailService.sendEmail.mockRejectedValue(
        new InternalServerErrorException('Failed to send email'),
      );

      await expect(
        service.inviteMember(admin as never, memberPayload),
      ).rejects.toBeInstanceOf(InternalServerErrorException);

      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'teacher-1' },
      });
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
          code: InvitationTokenErrorCode.INVALID,
          message: INVALID_INVITATION_TOKEN_MESSAGE,
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
});
