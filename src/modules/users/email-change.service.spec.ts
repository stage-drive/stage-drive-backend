import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RefreshTokenService } from '../auth/refresh-token.service';
import { MailSendFailedError, MailService } from '../mail/mail.service';
import {
  EMAIL_CHANGE_COOLDOWN_MESSAGE,
  EMAIL_CHANGE_TTL_MS,
  EmailChangeService,
  INVALID_EMAIL_CHANGE_TOKEN_MESSAGE,
  PASSWORD_REQUIRED_MESSAGE,
  SAME_EMAIL_MESSAGE,
} from './email-change.service';

jest.mock('bcrypt');

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function tokenFromMail(text: string): string {
  const match = /token=([^\s"&<]+)/.exec(text);
  if (!match) {
    throw new Error('No token link in email');
  }
  return decodeURIComponent(match[1]);
}

function uniqueEmailError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.9.1',
    meta: { target: ['email'] },
  });
}

describe('EmailChangeService', () => {
  let service: EmailChangeService;

  const user = { id: 'user-1', email: 'old@example.com' } as User;
  const fresh = {
    id: 'user-1',
    email: 'old@example.com',
    passwordHash: 'stored-hash',
  } as User;

  const tx = {
    emailChangeToken: { updateMany: jest.fn() },
    user: { update: jest.fn() },
  };
  const prisma = {
    user: { findUnique: jest.fn() },
    emailChangeToken: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const mailService = { sendEmail: jest.fn() };
  const refreshTokenService = { revokeAllForUser: jest.fn() };
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    prisma.user.findUnique.mockImplementation(
      ({ where }: { where: { id?: string; email?: string } }) =>
        Promise.resolve(where.id ? fresh : null),
    );
    prisma.emailChangeToken.findFirst.mockResolvedValue(null);
    prisma.emailChangeToken.updateMany.mockResolvedValue({ count: 0 });
    prisma.emailChangeToken.create.mockResolvedValue({ id: 'token-1' });
    prisma.emailChangeToken.delete.mockResolvedValue({ id: 'token-1' });
    tx.emailChangeToken.updateMany.mockResolvedValue({ count: 1 });
    tx.user.update.mockResolvedValue(fresh);
    mailService.sendEmail.mockResolvedValue({ messageId: 'msg-1' });
    refreshTokenService.revokeAllForUser.mockResolvedValue(undefined);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    service = new EmailChangeService(
      prisma as unknown as PrismaService,
      mailService as unknown as MailService,
      refreshTokenService as unknown as RefreshTokenService,
    );
  });

  describe('requestEmailChange', () => {
    it('stores only the token hash and mails the raw token to the new address', async () => {
      const before = Date.now();

      const result = await service.requestEmailChange(
        user,
        '  New@Example.com ',
        'CurrentPass1!',
      );

      expect(result).toEqual({
        message: 'Лист для підтвердження надіслано на нову адресу.',
      });
      expect(prisma.emailChangeToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', usedAt: null },
        data: { usedAt: expect.any(Date) },
      });

      const mail = mailService.sendEmail.mock.calls[0][0] as {
        to: string;
        text: string;
        html: string;
      };
      expect(mail.to).toBe('new@example.com');
      const token = tokenFromMail(mail.text);
      expect(mail.html).toContain('/confirm-email?token=');

      const created = prisma.emailChangeToken.create.mock.calls[0][0] as {
        data: {
          userId: string;
          newEmail: string;
          tokenHash: string;
          expiresAt: Date;
        };
      };
      expect(created.data.userId).toBe('user-1');
      expect(created.data.newEmail).toBe('new@example.com');
      expect(created.data.tokenHash).toBe(sha256(token));
      expect(created.data.tokenHash).not.toBe(token);
      expect(created.data.expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + EMAIL_CHANGE_TTL_MS,
      );
      expect(created.data.expiresAt.getTime()).toBeLessThanOrEqual(
        Date.now() + EMAIL_CHANGE_TTL_MS,
      );
    });

    it('rejects the current email after normalization', async () => {
      await expect(
        service.requestEmailChange(user, ' OLD@example.com ', 'CurrentPass1!'),
      ).rejects.toThrow(new BadRequestException(SAME_EMAIL_MESSAGE));

      expect(prisma.emailChangeToken.create).not.toHaveBeenCalled();
      expect(mailService.sendEmail).not.toHaveBeenCalled();
    });

    it('rejects accounts without a password (Google-only)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...fresh,
        passwordHash: null,
      });

      await expect(
        service.requestEmailChange(user, 'new@example.com', 'anything'),
      ).rejects.toThrow(new BadRequestException(PASSWORD_REQUIRED_MESSAGE));

      expect(bcrypt.compare).not.toHaveBeenCalled();
      expect(mailService.sendEmail).not.toHaveBeenCalled();
    });

    it('rejects a wrong current password with 400, not 401', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.requestEmailChange(user, 'new@example.com', 'WrongPass1!'),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.emailChangeToken.create).not.toHaveBeenCalled();
      expect(mailService.sendEmail).not.toHaveBeenCalled();
    });

    it('rejects an email that already belongs to another user with 409', async () => {
      prisma.user.findUnique.mockImplementation(
        ({ where }: { where: { id?: string; email?: string } }) =>
          Promise.resolve(where.id ? fresh : { id: 'user-2' }),
      );

      const error = await service
        .requestEmailChange(user, 'taken@example.com', 'CurrentPass1!')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual({
        statusCode: 409,
        errors: [
          { field: 'email', message: 'Користувач з таким email уже існує.' },
        ],
      });
      expect(prisma.emailChangeToken.create).not.toHaveBeenCalled();
    });

    it('rejects a repeated request within the cooldown with 429', async () => {
      prisma.emailChangeToken.findFirst.mockResolvedValue({ id: 'recent' });

      const error = await service
        .requestEmailChange(user, 'new@example.com', 'CurrentPass1!')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      expect((error as HttpException).message).toBe(
        EMAIL_CHANGE_COOLDOWN_MESSAGE,
      );
      expect(mailService.sendEmail).not.toHaveBeenCalled();
    });

    it('deletes the token and rethrows when the email cannot be sent', async () => {
      mailService.sendEmail.mockRejectedValue(
        new MailSendFailedError('SMTP down'),
      );

      await expect(
        service.requestEmailChange(user, 'new@example.com', 'CurrentPass1!'),
      ).rejects.toBeInstanceOf(MailSendFailedError);

      expect(prisma.emailChangeToken.delete).toHaveBeenCalledWith({
        where: { id: 'token-1' },
      });
    });
  });

  describe('verifyEmailChange', () => {
    const validRecord = {
      id: 'token-1',
      userId: 'user-1',
      newEmail: 'new@example.com',
      tokenHash: sha256('raw-token'),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    };

    it('changes the email, invalidates sessions and notifies the old address', async () => {
      prisma.emailChangeToken.findUnique.mockResolvedValue(validRecord);

      const result = await service.verifyEmailChange(user, 'raw-token');

      expect(result).toEqual({
        message: 'Email оновлено. Увійдіть знову з новою адресою.',
      });
      expect(prisma.emailChangeToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: sha256('raw-token') },
      });
      expect(tx.emailChangeToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'token-1', usedAt: null },
        data: { usedAt: expect.any(Date) },
      });
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          email: 'new@example.com',
          tokensInvalidBefore: expect.any(Date),
        },
      });
      expect(refreshTokenService.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
      );

      const notice = mailService.sendEmail.mock.calls[0][0] as {
        to: string;
        text: string;
      };
      expect(notice.to).toBe('old@example.com');
      expect(notice.text).toContain('new@example.com');
    });

    it.each([
      ['unknown', null],
      ['expired', { ...validRecord, expiresAt: new Date(Date.now() - 1) }],
      ['already used', { ...validRecord, usedAt: new Date() }],
      ["another user's", { ...validRecord, userId: 'user-2' }],
    ])('rejects an %s token with the same 400', async (_label, record) => {
      prisma.emailChangeToken.findUnique.mockResolvedValue(record);

      await expect(
        service.verifyEmailChange(user, 'raw-token'),
      ).rejects.toThrow(
        new BadRequestException(INVALID_EMAIL_CHANGE_TOKEN_MESSAGE),
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('rejects a token consumed by a concurrent request', async () => {
      prisma.emailChangeToken.findUnique.mockResolvedValue(validRecord);
      tx.emailChangeToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.verifyEmailChange(user, 'raw-token'),
      ).rejects.toThrow(
        new BadRequestException(INVALID_EMAIL_CHANGE_TOKEN_MESSAGE),
      );

      expect(tx.user.update).not.toHaveBeenCalled();
      expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('returns 409 when the new email was taken after the request', async () => {
      prisma.emailChangeToken.findUnique.mockResolvedValue(validRecord);
      tx.user.update.mockRejectedValue(uniqueEmailError());

      await expect(
        service.verifyEmailChange(user, 'raw-token'),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
      expect(mailService.sendEmail).not.toHaveBeenCalled();
    });

    it('still succeeds when the old address cannot be notified', async () => {
      prisma.emailChangeToken.findUnique.mockResolvedValue(validRecord);
      mailService.sendEmail.mockRejectedValue(
        new MailSendFailedError('SMTP down'),
      );

      await expect(
        service.verifyEmailChange(user, 'raw-token'),
      ).resolves.toEqual({
        message: 'Email оновлено. Увійдіть знову з новою адресою.',
      });
      expect(warn).toHaveBeenCalled();
    });
  });
});
