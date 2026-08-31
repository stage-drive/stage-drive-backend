import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthProvider } from '@prisma/client';
import { isUniqueConstraintOn } from '../../common/prisma/unique-constraint';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';
import { toAuthSession } from './auth-session';
import { GoogleProfile } from './google-id-token';
import { GoogleOAuthConfig } from './google-oauth.config';
import { GoogleOidcClient } from './google-oidc.client';
import { createPkcePair, randomOAuthValue } from './google-pkce';

const GOOGLE_AUTH_FAILED_MESSAGE = 'Не вдалося увійти через Google.';
const AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

function fail(): never {
  throw new UnauthorizedException(GOOGLE_AUTH_FAILED_MESSAGE);
}

@Injectable()
export class GoogleAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GoogleOAuthConfig,
    private readonly oidc: GoogleOidcClient,
    private readonly authService: AuthService,
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
      this.authService.assertActiveUser(user);
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
    if (input.error || !input.code?.trim() || !input.state?.trim()) {
      fail();
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
    } catch {
      fail();
    }

    const existingLink = await this.prisma.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: AuthProvider.GOOGLE,
          providerAccountId: profile.sub,
        },
      },
      include: { user: true },
    });

    if (existingLink) {
      if (pending.userId && pending.userId !== existingLink.userId) {
        fail();
      }
      this.authService.assertActiveUser(existingLink.user);
      await this.authService.recordLogin(existingLink.user.id);
      return toAuthSession(existingLink.user);
    }

    if (pending.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: pending.userId },
      });
      if (!user) {
        fail();
      }
      this.authService.assertActiveUser(user);
      await this.linkAccount(user.id, profile);
      await this.authService.recordLogin(user.id);
      return toAuthSession(user);
    }

    const byEmail = await this.prisma.user.findUnique({
      where: { email: profile.email },
    });
    if (byEmail) {
      this.authService.assertActiveUser(byEmail);
      await this.linkAccount(byEmail.id, profile);
      await this.authService.recordLogin(byEmail.id);
      return toAuthSession(byEmail);
    }

    try {
      const user = await this.authService.createOwnerUser({
        organizationName: profile.name,
        firstName: profile.givenName,
        lastName: profile.familyName,
        email: profile.email,
        passwordHash: null,
      });
      await this.linkAccount(user.id, profile);
      return toAuthSession(user);
    } catch (error) {
      if (error instanceof ConflictException) {
        const raced = await this.prisma.user.findUnique({
          where: { email: profile.email },
        });
        if (raced) {
          this.authService.assertActiveUser(raced);
          await this.linkAccount(raced.id, profile);
          await this.authService.recordLogin(raced.id);
          return toAuthSession(raced);
        }
      }
      fail();
    }
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
