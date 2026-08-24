import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './auth.dto';
import { AuthService } from './auth.service';

jest.mock('bcrypt');

const futureDate = () => new Date(Date.now() + 60_000);
const pastDate = () => new Date(Date.now() - 60_000);

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
    user: { findUnique: jest.fn() },
    refreshToken: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const jwtService = { signAsync: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get(AuthService);

    jwtService.signAsync.mockResolvedValue('signed-access-token');
    prisma.refreshToken.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'refresh-row-id', ...data }),
    );
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

    it('normalizes email casing/whitespace before lookup', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        passwordHash: 'stored-hash',
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
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login('owner@example.com', 'Password1');

      expect(result).toEqual({
        accessToken: 'signed-access-token',
        refreshToken: expect.stringMatching(/^refresh-row-id\..+/),
        tokenType: 'Bearer',
      });
    });
  });

  describe('refresh', () => {
    it('rejects a malformed token', async () => {
      await expect(service.refresh('not-a-valid-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects when the token row does not exist', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refresh('id.secret')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a revoked token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'id',
        userId: 'user-1',
        tokenHash: 'hash',
        revokedAt: new Date(),
        expiresAt: futureDate(),
      });

      await expect(service.refresh('id.secret')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an expired token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'id',
        userId: 'user-1',
        tokenHash: 'hash',
        revokedAt: null,
        expiresAt: pastDate(),
      });

      await expect(service.refresh('id.secret')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects when the secret does not match the stored hash', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'id',
        userId: 'user-1',
        tokenHash: 'hash',
        revokedAt: null,
        expiresAt: futureDate(),
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.refresh('id.secret')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rotates the token and returns a new pair on success', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'old-id',
        userId: 'user-1',
        tokenHash: 'hash',
        revokedAt: null,
        expiresAt: futureDate(),
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.refresh('old-id.secret');

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'old-id' },
        data: { revokedAt: expect.any(Date) },
      });
      expect(result).toEqual({
        accessToken: 'signed-access-token',
        refreshToken: expect.stringMatching(/^refresh-row-id\..+/),
      });
    });
  });

  describe('logout', () => {
    it('silently resolves when the token is already invalid', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.logout('id.secret')).resolves.toBeUndefined();
      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
    });

    it('revokes a valid token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'id',
        userId: 'user-1',
        tokenHash: 'hash',
        revokedAt: null,
        expiresAt: futureDate(),
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.logout('id.secret');

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'id' },
        data: { revokedAt: expect.any(Date) },
      });
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
          }),
        }),
      );
      expect(result).toEqual({
        user: createdUser,
        accessToken: 'signed-access-token',
        refreshToken: expect.stringMatching(/^refresh-row-id\..+/),
      });
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
      // initial attempt + MAX_SLUG_ATTEMPTS retries
      expect(prisma.$transaction).toHaveBeenCalledTimes(6);
    });
  });
});
