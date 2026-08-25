import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthProvider, Prisma, User, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';
import { GoogleAuthService } from './google-auth.service';
import { GoogleProfile } from './google-id-token';
import { GoogleOAuthConfig } from './google-oauth.config';
import { GoogleOidcClient } from './google-oidc.client';
import { verifyAccessToken, verifyRefreshToken } from './token';

const GOOGLE_AUTH_FAILED = 'Не вдалося увійти через Google.';

const owner: User = {
  id: 'user-existing',
  email: 'owner@example.com',
  passwordHash: 'hash',
  firstName: 'Ivan',
  lastName: 'Petrenko',
  phone: null,
  avatarUrl: null,
  role: UserRole.OWNER,
  status: 'ACTIVE',
  organizationId: 'org-1',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const googleUser: User = {
  ...owner,
  id: 'user-google',
  email: 'ada@gmail.com',
  passwordHash: null,
  firstName: 'Ada',
  lastName: 'Lovelace',
};

const profile: GoogleProfile = {
  sub: 'google-sub-1',
  email: 'ada@gmail.com',
  givenName: 'Ada',
  familyName: 'Lovelace',
  name: 'Ada Lovelace',
};

function uniqueError(fields: string[]) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: fields },
  });
}

type PendingAuth = {
  id: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  userId: string | null;
  expiresAt: Date;
};

type OauthRow = {
  id?: string;
  userId: string;
  provider: AuthProvider;
  providerAccountId: string;
  email?: string;
};

describe('GoogleAuthService', () => {
  let service: GoogleAuthService;
  let authorizations: Map<string, PendingAuth>;
  let accounts: OauthRow[];
  let users: User[];
  let prisma: {
    oAuthAuthorization: {
      deleteMany: jest.Mock;
      delete: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
    };
    oAuthAccount: {
      findUnique: jest.Mock;
      create: jest.Mock;
    };
    user: { findUnique: jest.Mock };
  };
  let oidc: { exchangeCode: jest.Mock; verifyIdToken: jest.Mock };
  let authService: { createOwnerUser: jest.Mock };

  beforeEach(() => {
    authorizations = new Map();
    accounts = [];
    users = [{ ...owner }];

    prisma = {
      oAuthAuthorization: {
        deleteMany: jest.fn(
          ({ where }: { where: { expiresAt?: { lt: Date }; id?: string } }) => {
            if (where.id) {
              const found = [...authorizations.values()].find(
                (row) => row.id === where.id,
              );
              if (!found) {
                return Promise.resolve({ count: 0 });
              }
              authorizations.delete(found.state);
              return Promise.resolve({ count: 1 });
            }
            return Promise.resolve({ count: 0 });
          },
        ),
        delete: jest.fn(({ where }: { where: { id: string } }) => {
          const found = [...authorizations.values()].find(
            (row) => row.id === where.id,
          );
          if (found) {
            authorizations.delete(found.state);
          }
          return Promise.resolve(found);
        }),
        create: jest.fn(
          ({ data }: { data: Omit<PendingAuth, 'id'> & { id?: string } }) => {
            const row: PendingAuth = { id: data.id ?? 'pending-1', ...data };
            authorizations.set(row.state, row);
            return Promise.resolve(row);
          },
        ),
        findUnique: jest.fn(({ where }: { where: { state: string } }) =>
          Promise.resolve(authorizations.get(where.state) ?? null),
        ),
      },
      oAuthAccount: {
        findUnique: jest.fn(
          ({
            where,
          }: {
            where: {
              provider_providerAccountId: {
                provider: AuthProvider;
                providerAccountId: string;
              };
            };
          }) => {
            const found = accounts.find(
              (account) =>
                account.provider ===
                  where.provider_providerAccountId.provider &&
                account.providerAccountId ===
                  where.provider_providerAccountId.providerAccountId,
            );
            if (!found) {
              return Promise.resolve(null);
            }
            const user = users.find((item) => item.id === found.userId);
            return Promise.resolve({ ...found, user });
          },
        ),
        create: jest.fn(({ data }: { data: OauthRow }) => {
          const duplicate = accounts.find(
            (account) =>
              account.provider === data.provider &&
              account.providerAccountId === data.providerAccountId,
          );
          if (duplicate) {
            throw uniqueError(['provider', 'providerAccountId']);
          }
          const row = { id: `oauth-${accounts.length + 1}`, ...data };
          accounts.push(row);
          return Promise.resolve(row);
        }),
      },
      user: {
        findUnique: jest.fn(
          ({ where }: { where: { id?: string; email?: string } }) => {
            if (where.id) {
              return Promise.resolve(
                users.find((item) => item.id === where.id) ?? null,
              );
            }
            if (where.email) {
              return Promise.resolve(
                users.find((item) => item.email === where.email) ?? null,
              );
            }
            return Promise.resolve(null);
          },
        ),
      },
    };

    oidc = {
      exchangeCode: jest.fn().mockResolvedValue('id-token'),
      verifyIdToken: jest.fn().mockResolvedValue(profile),
    };
    authService = {
      createOwnerUser: jest.fn().mockResolvedValue(googleUser),
    };

    const config: Pick<
      GoogleOAuthConfig,
      | 'enabled'
      | 'clientId'
      | 'clientSecret'
      | 'redirectUri'
      | 'successRedirect'
    > = {
      enabled: true,
      clientId: 'test-google-client-id',
      clientSecret: 'test-secret',
      redirectUri: 'http://localhost:3000/api/auth/google/callback',
      successRedirect: null,
    };

    service = new GoogleAuthService(
      prisma as unknown as PrismaService,
      config,
      oidc as unknown as GoogleOidcClient,
      authService as unknown as AuthService,
    );
  });

  function seedPending(overrides: Partial<PendingAuth> = {}) {
    const pending: PendingAuth = {
      id: 'pending-1',
      state: 'state-1',
      nonce: 'nonce-1',
      codeVerifier: 'verifier-1',
      userId: null,
      expiresAt: new Date(Date.now() + 60_000),
      ...overrides,
    };
    authorizations.set(pending.state, pending);
    return pending;
  }

  it('start() redirects to Google with PKCE and stores state', async () => {
    const url = await service.start();
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(parsed.searchParams.get('client_id')).toBe('test-google-client-id');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('code_challenge')).toBeTruthy();
    expect(parsed.searchParams.get('state')).toBeTruthy();
    expect(parsed.searchParams.get('nonce')).toBeTruthy();
    expect(prisma.oAuthAuthorization.create).toHaveBeenCalled();
  });

  it('stores the current user id for explicit account linking', async () => {
    await service.start(owner.id);

    expect(prisma.oAuthAuthorization.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: owner.id }),
      }),
    );
  });

  it('creates a new user for a first-time Google identity', async () => {
    seedPending();

    const session = await service.complete({
      code: 'code-1',
      state: 'state-1',
    });

    expect(authService.createOwnerUser).toHaveBeenCalledWith({
      organizationName: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@gmail.com',
      passwordHash: null,
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      userId: googleUser.id,
      provider: AuthProvider.GOOGLE,
      providerAccountId: 'google-sub-1',
    });
    expect(verifyAccessToken(session.accessToken).sub).toBe(googleUser.id);
    expect(verifyRefreshToken(session.refreshToken).sub).toBe(googleUser.id);
    expect(session.user.email).toBe('ada@gmail.com');
  });

  it('links a verified Google email to an existing user', async () => {
    users = [{ ...owner, email: 'ada@gmail.com' }];
    seedPending();

    const session = await service.complete({
      code: 'code-1',
      state: 'state-1',
    });

    expect(authService.createOwnerUser).not.toHaveBeenCalled();
    expect(accounts[0]).toMatchObject({
      userId: owner.id,
      providerAccountId: 'google-sub-1',
    });
    expect(verifyAccessToken(session.accessToken).sub).toBe(owner.id);
  });

  it('links Google to an already authenticated user', async () => {
    seedPending({ userId: owner.id });

    const session = await service.complete({
      code: 'code-1',
      state: 'state-1',
    });

    expect(authService.createOwnerUser).not.toHaveBeenCalled();
    expect(accounts[0]).toMatchObject({
      userId: owner.id,
      providerAccountId: 'google-sub-1',
    });
    expect(session.user.id).toBe(owner.id);
  });

  it('does not attach one Google identity to a second user', async () => {
    accounts.push({
      userId: owner.id,
      provider: AuthProvider.GOOGLE,
      providerAccountId: 'google-sub-1',
    });
    seedPending({ userId: 'another-user' });

    await expect(
      service.complete({ code: 'code-1', state: 'state-1' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(accounts).toHaveLength(1);
    expect(accounts[0].userId).toBe(owner.id);
  });

  it('rejects an invalid callback state without exchanging the code', async () => {
    await expect(
      service.complete({ code: 'code-1', state: 'missing-state' }),
    ).rejects.toThrow(GOOGLE_AUTH_FAILED);

    expect(oidc.exchangeCode).not.toHaveBeenCalled();
    expect(authService.createOwnerUser).not.toHaveBeenCalled();
  });

  it('rejects expired callback state', async () => {
    seedPending({ expiresAt: new Date(Date.now() - 1000) });

    await expect(
      service.complete({ code: 'code-1', state: 'state-1' }),
    ).rejects.toThrow(GOOGLE_AUTH_FAILED);

    expect(oidc.exchangeCode).not.toHaveBeenCalled();
  });

  it('rejects an unverified Google email without revealing a local account', async () => {
    users = [{ ...owner, email: 'ada@gmail.com' }];
    seedPending();
    oidc.verifyIdToken.mockRejectedValue(new Error('unverified'));

    await expect(
      service.complete({ code: 'code-1', state: 'state-1' }),
    ).rejects.toThrow(GOOGLE_AUTH_FAILED);

    expect(authService.createOwnerUser).not.toHaveBeenCalled();
    expect(accounts).toHaveLength(0);
    expect(prisma.oAuthAccount.create).not.toHaveBeenCalled();
  });

  it('links after a create race on email without returning 409', async () => {
    seedPending();
    authService.createOwnerUser.mockRejectedValue(
      new ConflictException({
        statusCode: 409,
        errors: [{ field: 'email', message: 'exists' }],
      }),
    );
    users = [{ ...owner, email: 'ada@gmail.com' }];

    const session = await service.complete({
      code: 'code-1',
      state: 'state-1',
    });

    expect(session.user.id).toBe(owner.id);
    expect(accounts[0].userId).toBe(owner.id);
  });
});
