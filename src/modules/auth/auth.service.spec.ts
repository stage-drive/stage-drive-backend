import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ACCESS_DENIED_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
} from './auth-access';
import { RegisterDto } from './auth.dto';
import { AuthService } from './auth.service';
import { RefreshTokenService } from './refresh-token.service';
import { verifyAccessToken } from './token';

jest.mock('bcrypt');

function uniqueConstraintError(field: string) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.9.1',
    meta: { target: [field] },
  });
}

describe('AuthService', () => {
  let service: AuthService;

  const prisma = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  };
  const refreshTokenService = {
    issue: jest.fn().mockResolvedValue('mock-refresh-token'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    refreshTokenService.issue.mockResolvedValue('mock-refresh-token');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: RefreshTokenService, useValue: refreshTokenService },
      ],
    }).compile();

    service = module.get(AuthService);
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-secret');
  });

  describe('login', () => {
    const activeUser = {
      id: 'user-1',
      passwordHash: 'stored-hash',
      status: UserStatus.ACTIVE,
      deletedAt: null as Date | null,
      organization: { status: 'ACTIVE' },
    };

    it('rejects when email or password is missing', async () => {
      await expect(service.login('', 'password')).rejects.toMatchObject({
        message: INVALID_CREDENTIALS_MESSAGE,
        status: 401,
      });
      await expect(service.login('owner@example.com', '')).rejects.toMatchObject(
        {
          message: INVALID_CREDENTIALS_MESSAGE,
          status: 401,
        },
      );
    });

    it('rejects when the user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login('missing@example.com', 'Password1'),
      ).rejects.toMatchObject({
        message: INVALID_CREDENTIALS_MESSAGE,
        status: 401,
      });
    });

    it('rejects a Google-only user without a password', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        passwordHash: null,
      });

      await expect(
        service.login('owner@example.com', 'Password1'),
      ).rejects.toMatchObject({
        message: INVALID_CREDENTIALS_MESSAGE,
        status: 401,
      });
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('rejects when the password does not match', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login('owner@example.com', 'WrongPassword'),
      ).rejects.toMatchObject({
        message: INVALID_CREDENTIALS_MESSAGE,
        status: 401,
      });
    });

    it('rejects a blocked user with a matching password using 403', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        status: UserStatus.BLOCKED,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        service.login('owner@example.com', 'Password1'),
      ).rejects.toMatchObject({
        message: ACCESS_DENIED_MESSAGE,
        status: 403,
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects an archived user with a matching password using 403', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        status: UserStatus.ARCHIVED,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        service.login('owner@example.com', 'Password1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a user from a blocked organization using 403', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        organization: { status: 'BLOCKED' },
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        service.login('owner@example.com', 'Password1'),
      ).rejects.toMatchObject({
        message: ACCESS_DENIED_MESSAGE,
        status: 403,
      });
    });

    it('still returns 401 when a blocked user enters the wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        status: UserStatus.BLOCKED,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login('owner@example.com', 'WrongPassword'),
      ).rejects.toMatchObject({
        message: INVALID_CREDENTIALS_MESSAGE,
        status: 401,
      });
    });

    it('rejects a soft-deleted user with a matching password using 403', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        deletedAt: new Date('2026-01-01'),
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        service.login('owner@example.com', 'Password1'),
      ).rejects.toMatchObject({
        message: ACCESS_DENIED_MESSAGE,
        status: 403,
      });
    });

    it('normalizes email casing/whitespace before lookup', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.login('  Owner@Example.com ', 'Password1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'owner@example.com' },
        include: { organization: true },
      });
    });

    it('activates an invited user after a successful password check', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        status: UserStatus.INVITED,
      });
      prisma.user.update.mockResolvedValue({
        ...activeUser,
        status: UserStatus.ACTIVE,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login('owner@example.com', 'Password1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { status: UserStatus.ACTIVE },
      });
      expect(verifyAccessToken(result.accessToken).sub).toBe('user-1');
    });

    it('returns a token pair on success', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login('owner@example.com', 'Password1');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { lastLoginAt: expect.any(Date) },
      });
      expect(verifyAccessToken(result.accessToken).sub).toBe('user-1');
      expect(refreshTokenService.issue).toHaveBeenCalledWith('user-1');
      expect(result.refreshToken).toBe('mock-refresh-token');
      expect(result.tokenType).toBe('Bearer');
    });
  });

  describe('register', () => {
    const payload: RegisterDto = {
      organizationName: 'Тест Школа',
      firstName: 'Іван',
      lastName: 'Петренко',
      email: 'Owner@Example.com ',
      phone: undefined,
      password: 'Password1',
      passwordConfirmation: 'Password1',
      termsAccepted: true,
    };

    const createdUser = {
      id: 'user-1',
      firstName: 'Іван',
      lastName: 'Петренко',
      email: 'owner@example.com',
      role: UserRole.OWNER,
      status: 'ACTIVE',
      organizationId: 'org-1',
    };

    it('creates the organization and owner user in one transaction', async () => {
      const tx = {
        organization: { create: jest.fn().mockResolvedValue({ id: 'org-1' }) },
        user: { create: jest.fn().mockResolvedValue(createdUser) },
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
        cb(tx),
      );

      const result = await service.register(payload);

      expect(tx.organization.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'owner@example.com' }),
        }),
      );
      expect(tx.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: UserRole.OWNER,
            organizationId: 'org-1',
            passwordHash: 'hashed-secret',
          }),
        }),
      );
      expect(result.user).toEqual(createdUser);
      expect(verifyAccessToken(result.accessToken).sub).toBe('user-1');
      expect(refreshTokenService.issue).toHaveBeenCalledWith('user-1');
      expect(result.refreshToken).toBe('mock-refresh-token');
    });

    it('rejects with ConflictException when the email is already taken', async () => {
      prisma.$transaction.mockRejectedValue(uniqueConstraintError('email'));

      await expect(service.register(payload)).rejects.toThrow(
        ConflictException,
      );
    });

    it('retries once with a new slug on a slug collision, then succeeds', async () => {
      const tx = {
        organization: { create: jest.fn().mockResolvedValue({ id: 'org-1' }) },
        user: { create: jest.fn().mockResolvedValue(createdUser) },
      };
      prisma.$transaction
        .mockRejectedValueOnce(uniqueConstraintError('slug'))
        .mockImplementationOnce((cb: (tx: unknown) => unknown) => cb(tx));

      const result = await service.register(payload);

      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(result.user.id).toBe('user-1');
    });

    it('gives up and rethrows after exhausting slug retries', async () => {
      prisma.$transaction.mockRejectedValue(uniqueConstraintError('slug'));

      await expect(service.register(payload)).rejects.toThrow(
        Prisma.PrismaClientKnownRequestError,
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(6);
    });
  });
});
