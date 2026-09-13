import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InvitationStatus, Prisma, UserRole, UserStatus } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  EMAIL_ALREADY_EXISTS_MESSAGE,
  invitationAcceptUrl,
  InvitationsService,
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
    organizationId: 'org-1',
  };

  const payload = {
    firstName: ' Олена ',
    lastName: 'Коваль',
    email: 'Admin@Example.com ',
    phone: ' +380991234567 ',
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

  const prisma = {
    organization: { findUnique: jest.fn() },
    user: { delete: jest.fn() },
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
});
