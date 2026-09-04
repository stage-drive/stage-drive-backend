import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthGuard } from './auth.guard';
import { signAccessToken } from './token';

function contextWith(authorization?: string): ExecutionContext {
  const request: { headers: Record<string, string>; user?: unknown } = {
    headers: authorization ? { authorization } : {},
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  let guard: AuthGuard;
  const user = {
    id: 'user-1',
    status: UserStatus.ACTIVE,
    deletedAt: null as Date | null,
    tokensInvalidBefore: null as Date | null,
  };
  const prisma = {
    user: { findUnique: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new AuthGuard(prisma as unknown as PrismaService);
  });

  it('rejects a missing token', async () => {
    await expect(
      guard.canActivate(contextWith(undefined)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a malformed/tampered token', async () => {
    await expect(
      guard.canActivate(contextWith('Bearer not-a-real-token')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows a valid token for an active user with no invalidation point', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...user });
    const token = signAccessToken(user.id);

    await expect(
      guard.canActivate(contextWith(`Bearer ${token}`)),
    ).resolves.toBe(true);
  });

  it('rejects a token issued before tokensInvalidBefore', async () => {
    const token = signAccessToken(user.id);
    prisma.user.findUnique.mockResolvedValue({
      ...user,
      tokensInvalidBefore: new Date(Date.now() + 1000),
    });

    await expect(
      guard.canActivate(contextWith(`Bearer ${token}`)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows a token issued after tokensInvalidBefore', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...user,
      tokensInvalidBefore: new Date(Date.now() - 1000),
    });
    const token = signAccessToken(user.id);

    await expect(
      guard.canActivate(contextWith(`Bearer ${token}`)),
    ).resolves.toBe(true);
  });

  it('rejects an inactive user even with a fresh token', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...user,
      status: UserStatus.BLOCKED,
    });
    const token = signAccessToken(user.id);

    await expect(
      guard.canActivate(contextWith(`Bearer ${token}`)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
