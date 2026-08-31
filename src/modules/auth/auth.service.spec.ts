import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './auth.dto';
import { AuthService } from './auth.service';
import { verifyAccessToken, verifyRefreshToken } from './token';

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

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuthService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(AuthService);
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-secret');
  });

  describe('login', () => {
    it('rejects when email or password is missing', async () => {
      await expect(service.login('', 'password')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.login('owner@example.com', '')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects when the user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login('missing@example.com', 'Password1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a Google-only user without a password', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        passwordHash: null,
      });

      await expect(
        service.login('owner@example.com', 'Password1'),
      ).rejects.toThrow(UnauthorizedException);
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('rejects when the password does not match', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        passwordHash: 'stored-hash',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login('owner@example.com', 'WrongPassword'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when the user is not active', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        passwordHash: 'stored-hash',
        status: 'BLOCKED',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        service.login('owner@example.com', 'Password1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('normalizes email casing/whitespace before lookup', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        passwordHash: 'stored-hash',
        status: 'ACTIVE',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.login('  Owner@Example.com ', 'Password1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'owner@example.com' },
      });
    });

    it('returns a token pair on success', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        passwordHash: 'stored-hash',
        status: 'ACTIVE',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login('owner@example.com', 'Password1');

      expect(verifyAccessToken(result.accessToken).sub).toBe('user-1');
      expect(verifyRefreshToken(result.refreshToken).sub).toBe('user-1');
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
      expect(verifyRefreshToken(result.refreshToken).sub).toBe('user-1');
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
