import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthProvider, User, UserStatus } from '@prisma/client';
import { isUniqueConstraintOn } from '../../common/prisma/unique-constraint';
import { PrismaService } from '../../prisma/prisma.service';
import { assertSignInAllowed } from './auth-access';
import { toAuthSession } from './auth-session';
import { AuthService } from './auth.service';
import { GoogleProfile } from './google-id-token';
import { GoogleOAuthConfig } from './google-oauth.config';
import { GoogleOidcClient } from './google-oidc.client';
import { createPkcePair, randomOAuthValue } from './google-pkce';
import { RefreshTokenService } from './refresh-token.service';

const GOOGLE_AUTH_FAILED_MESSAGE = 'Не вдалося увійти через Google.';
const GOOGLE_ACCOUNT_NOT_FOUND_MESSAGE = 'Акаунт не знайдено';
const AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

function fail(): never {
  throw new UnauthorizedException(GOOGLE_AUTH_FAILED_MESSAGE);
}

@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GoogleOAuthConfig,
    private readonly oidc: GoogleOidcClient,
    private readonly authService: AuthService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  private ensureConfigured() {
    if (!this.config.enabled) {
      throw new ServiceUnavailableException(
        'Вхід через Google не налаштовано.',
      );
    }
  }

  async start(userId?: string): Promise<string> {
    this.ensureConfigured();

    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) {
        fail();
      }
      this.assertAllowed(user);
    }

    await this.prisma.oAuthAuthorization.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    const { verifier, challenge } = createPkcePair();
    const state = randomOAuthValue();
    const nonce = randomOAuthValue();

    await this.prisma.oAuthAuthorization.create({
      data: {
        state,
        nonce,
        codeVerifier: verifier,
        userId: userId ?? null,
        expiresAt: new Date(Date.now() + AUTHORIZATION_TTL_MS),
      },
    });

    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('prompt', 'select_account');
    return url.toString();
  }

  async complete(input: { code?: string; state?: string; error?: string }) {
    this.ensureConfigured();
    if (input.error) {
      this.logger.warn(`Google callback error=${input.error}`);
      fail();
    }
    if (!input.code?.trim()) {
      throw new UnauthorizedException(
        'Немає authorization code від Google. Відкрийте /api/auth/google знову і не оновлюйте сторінку callback.',
      );
    }
    if (!input.state?.trim()) {
      throw new UnauthorizedException(
        'Немає state. Відкрийте /api/auth/google знову.',
      );
    }

    const pending = await this.prisma.oAuthAuthorization.findUnique({
      where: { state: input.state },
    });
    if (!pending || pending.expiresAt.getTime() <= Date.now()) {
      if (pending) {
        await this.prisma.oAuthAuthorization
          .delete({ where: { id: pending.id } })
          .catch(() => undefined);
      }
      this.logger.warn('Google callback rejected: unknown or expired state');
      fail();
    }

    const consumed = await this.prisma.oAuthAuthorization.deleteMany({
      where: { id: pending.id },
    });
    if (consumed.count !== 1) {
      fail();
    }

    let profile: GoogleProfile;
    try {
      const idToken = await this.oidc.exchangeCode(
        input.code,
        pending.codeVerifier,
      );
      profile = await this.oidc.verifyIdToken(idToken, pending.nonce);
    } catch (error) {
      this.logger.warn(
        `Google callback token failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      fail();
    }

    return this.sessionFromProfile(profile, pending.userId);
  }

  async completeWithIdToken(idToken: string, linkingUserId?: string) {
    this.ensureConfigured();
    if (!idToken?.trim()) {
      fail();
    }

    let profile: GoogleProfile;
    try {
      profile = await this.oidc.verifyIdToken(idToken.trim());
    } catch {
      fail();
    }

    return this.sessionFromProfile(profile, linkingUserId ?? null);
  }

  private async sessionFromProfile(
    profile: GoogleProfile,
    linkingUserId: string | null,
  ) {
    const googleId = profile.sub;

    const oauthAccount = await this.prisma.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: AuthProvider.GOOGLE,
          providerAccountId: googleId,
        },
      },
      include: { user: true },
    });

    if (!oauthAccount) {
      if (linkingUserId) {
        const currentUser = await this.prisma.user.findUnique({
          where: { id: linkingUserId },
        });
        if (!currentUser) {
          fail();
        }
        this.assertAllowed(currentUser);
        await this.linkAccount(currentUser.id, profile);
        return this.authorizeUser(currentUser);
      }

      const existingUser = await this.findUserByGoogleEmail(profile.email);
      if (!existingUser) {
        throw new UnauthorizedException(GOOGLE_ACCOUNT_NOT_FOUND_MESSAGE);
      }
      this.assertAllowed(existingUser);
      await this.linkAccount(existingUser.id, profile);
      return this.authorizeUser(existingUser);
    }

    if (linkingUserId && linkingUserId !== oauthAccount.userId) {
      fail();
    }
    return this.authorizeUser(oauthAccount.user);
  }

  private async findUserByGoogleEmail(email: string) {
    return this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        email: { equals: email, mode: 'insensitive' },
      },
    });
  }

  private assertAllowed(user: User) {
    assertSignInAllowed(user);
  }

  private async authorizeUser(user: User) {
    this.assertAllowed(user);
    const session = await this.sessionFor(user);
    await this.authService.recordLogin(user.id);
    return session;
  }

  private async sessionFor(user: User) {
    if (user.status !== UserStatus.INVITED) {
      return toAuthSession(user, this.refreshTokenService);
    }
    const activated = await this.prisma.user.update({
      where: { id: user.id },
      data: { status: UserStatus.ACTIVE },
    });
    return toAuthSession(activated, this.refreshTokenService);
  }

  private async linkAccount(userId: string, profile: GoogleProfile) {
    try {
      await this.prisma.oAuthAccount.create({
        data: {
          userId,
          provider: AuthProvider.GOOGLE,
          providerAccountId: profile.sub,
          email: profile.email,
        },
      });
    } catch (error) {
      if (
        isUniqueConstraintOn(error, 'providerAccountId') ||
        isUniqueConstraintOn(error, 'provider')
      ) {
        const existing = await this.prisma.oAuthAccount.findUnique({
          where: {
            provider_providerAccountId: {
              provider: AuthProvider.GOOGLE,
              providerAccountId: profile.sub,
            },
          },
        });
        if (existing?.userId === userId) {
          return;
        }
      }
      fail();
    }
  }
}
