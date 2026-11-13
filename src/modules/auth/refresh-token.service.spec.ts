import { UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RefreshTokenService } from './refresh-token.service';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

type TokenRow = {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
};

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;
  let tokens: TokenRow[];
  let nextId: number;
  let prisma: {
    refreshToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    user: { findUnique: jest.Mock };
  };

  const activeUser = {
    id: 'user-1',
    status: UserStatus.ACTIVE,
    deletedAt: null as Date | null,
  };

  beforeEach(() => {
    tokens = [];
    nextId = 1;

    prisma = {
      refreshToken: {
        create: jest.fn(({ data }) => {
          const row: TokenRow = {
            id: `token-${nextId++}`,
            usedAt: null,
            revokedAt: null,
            ...data,
          };
          tokens.push(row);
          return Promise.resolve(row);
        }),
        findUnique: jest.fn(({ where }: { where: { tokenHash: string } }) =>
          Promise.resolve(
            tokens.find((row) => row.tokenHash === where.tokenHash) ?? null,
          ),
        ),
        update: jest.fn(
          ({
            where,
            data,
          }: {
            where: { id: string };
            data: Partial<TokenRow>;
          }) => {
            const row = tokens.find((item) => item.id === where.id);
            if (!row) {
              throw new Error('not found');
            }
            Object.assign(row, data);
            return Promise.resolve(row);
          },
        ),
        updateMany: jest.fn(
          ({
            where,
            data,
          }: {
            where: { familyId?: string; userId?: string; revokedAt: null };
            data: Partial<TokenRow>;
          }) => {
            const matching = tokens.filter(
              (row) =>
                (where.familyId === undefined ||
                  row.familyId === where.familyId) &&
                (where.userId === undefined || row.userId === where.userId) &&
                !row.revokedAt,
            );
            matching.forEach((row) => Object.assign(row, data));
            return Promise.resolve({ count: matching.length });
          },
        ),
      },
      user: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(where.id === activeUser.id ? activeUser : null),
        ),
      },
    };

    service = new RefreshTokenService(prisma as unknown as PrismaService);
  });

  it('issues a token and persists only its SHA-256 hash', async () => {
    const token = await service.issue(activeUser.id);

    expect(tokens).toHaveLength(1);
    expect(tokens[0].userId).toBe(activeUser.id);
    expect(tokens[0].tokenHash).toBe(sha256Hex(token));
    expect(JSON.stringify(tokens[0])).not.toContain(token);
    expect(JSON.stringify(prisma.refreshToken.create.mock.calls)).not.toContain(
      token,
    );
  });

  it('issues 48 random bytes per token, so the unsalted hash cannot be brute-forced', async () => {
    const first = await service.issue(activeUser.id);
    const second = await service.issue(activeUser.id);

    expect(Buffer.from(first, 'base64url')).toHaveLength(48);
    expect(first).not.toBe(second);
  });

  it('never sends a plaintext refresh token to the database across issue, rotate and logout', async () => {
    const original = await service.issue(activeUser.id);
    const { refreshToken: rotated } = await service.rotate(original);
    await service.logout(rotated);

    expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: sha256Hex(original) },
    });
    expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: sha256Hex(rotated) },
    });
    expect(tokens.map((row) => row.tokenHash)).toEqual([
      sha256Hex(original),
      sha256Hex(rotated),
    ]);

    const everythingSentToDb = JSON.stringify([
      prisma.refreshToken.create.mock.calls,
      prisma.refreshToken.findUnique.mock.calls,
      prisma.refreshToken.update.mock.calls,
      prisma.refreshToken.updateMany.mock.calls,
      prisma.user.findUnique.mock.calls,
    ]);
    expect(everythingSentToDb).not.toContain(original);
    expect(everythingSentToDb).not.toContain(rotated);
  });

  it('cannot be redeemed with the stored hash itself (a leaked DB row is not a token)', async () => {
    await service.issue(activeUser.id);

    await expect(service.rotate(tokens[0].tokenHash)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rotates a valid token exactly once into a new access/refresh pair', async () => {
    const token = await service.issue(activeUser.id);

    const result = await service.rotate(token);

    expect(result.tokenType).toBe('Bearer');
    expect(result.refreshToken).not.toBe(token);
    expect(tokens[0].usedAt).not.toBeNull();
  });

  it('rejects an unknown refresh token', async () => {
    await expect(service.rotate('not-a-real-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an expired refresh token', async () => {
    const token = await service.issue(activeUser.id);
    tokens[0].expiresAt = new Date(Date.now() - 1000);

    await expect(service.rotate(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects reuse of an already-rotated token and revokes its family', async () => {
    const token = await service.issue(activeUser.id);
    const { refreshToken: rotatedToken } = await service.rotate(token);

    await expect(service.rotate(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(tokens.every((row) => row.revokedAt)).toBe(true);
    await expect(service.rotate(rotatedToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects rotation for an inactive user', async () => {
    const token = await service.issue('blocked-user');
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'blocked-user',
      status: UserStatus.BLOCKED,
      deletedAt: null,
    });

    await expect(service.rotate(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('revokeAllForUser revokes every live token for that user, leaving other users untouched', async () => {
    const ownToken = await service.issue(activeUser.id);
    await service.issue(activeUser.id);
    const otherUserToken = await service.issue('other-user');

    await service.revokeAllForUser(activeUser.id);

    await expect(service.rotate(ownToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(
      tokens
        .filter((row) => row.userId === activeUser.id)
        .every((row) => row.revokedAt),
    ).toBe(true);

    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'other-user',
      status: UserStatus.ACTIVE,
      deletedAt: null,
    });
    await expect(service.rotate(otherUserToken)).resolves.toMatchObject({
      tokenType: 'Bearer',
    });
  });

  it('logout revokes the token family and is idempotent', async () => {
    const token = await service.issue(activeUser.id);

    await service.logout(token);

    expect(tokens.every((row) => row.revokedAt)).toBe(true);
    await expect(service.rotate(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    await expect(service.logout(token)).resolves.toBeUndefined();
  });

  it('logout on an unknown token resolves without throwing or changing state', async () => {
    await service.issue(activeUser.id);

    await expect(service.logout('not-a-real-token')).resolves.toBeUndefined();
    expect(tokens.every((row) => !row.revokedAt)).toBe(true);
  });

  it('logout only revokes the matching session, leaving other sessions of the same user active', async () => {
    const sessionA = await service.issue(activeUser.id);
    const sessionB = await service.issue(activeUser.id);

    await service.logout(sessionA);

    await expect(service.rotate(sessionA)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.rotate(sessionB)).resolves.toMatchObject({
      tokenType: 'Bearer',
    });
  });
});
