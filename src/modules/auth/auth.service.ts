import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { slugify, randomSlugSuffix } from './slug';
import { RegisterDto } from './auth.dto';
import { toRegisteredUser } from './registered-user';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';

const BCRYPT_ROUNDS = 10;
const MAX_SLUG_ATTEMPTS = 5;
const EMAIL_ALREADY_EXISTS_MESSAGE = 'Користувач з таким email уже існує.';
const INVALID_RESET_TOKEN_MESSAGE =
  'Посилання для скидання пароля недійсне або застаріле.';

function uniqueConstraintFields(
  error: Prisma.PrismaClientKnownRequestError,
): string[] {
  const meta = error.meta as
    | {
        target?: string[];
        driverAdapterError?: {
          cause?: { constraint?: { fields?: string[] } };
        };
      }
    | undefined;
  return (
    meta?.target ?? meta?.driverAdapterError?.cause?.constraint?.fields ?? []
  );
}

function isUniqueConstraintOn(error: unknown, field: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    uniqueConstraintFields(error).includes(field)
  );
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  private readonly REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  private readonly RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

  async login(email: string, password: string) {
    if (!email || !password) {
      throw new UnauthorizedException('Email and password are required');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.issueTokens(user.id);
    return {
      ...tokens,
      tokenType: 'Bearer',
    };
  }

  async refresh(refreshToken: string) {
    const storedToken = await this.validateRefreshToken(refreshToken);

    if (!storedToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(storedToken.userId);
  }

  async logout(refreshToken: string) {
    const storedToken = await this.validateRefreshToken(refreshToken);

    if (!storedToken) return;

    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });
  }

  async register(payload: RegisterDto) {
    const organizationName = payload.organizationName.trim();
    const firstName = payload.firstName.trim();
    const lastName = payload.lastName.trim();
    const email = payload.email.trim().toLowerCase();
    const phone = payload.phone?.trim() || null;

    const passwordHash = await bcrypt.hash(payload.password, BCRYPT_ROUNDS);
    const baseSlug = slugify(organizationName);

    for (let attempt = 0; ; attempt += 1) {
      const slug =
        attempt === 0 ? baseSlug : `${baseSlug}-${randomSlugSuffix()}`;

      try {
        const user = await this.prisma.$transaction(async (tx) => {
          const organization = await tx.organization.create({
            data: {
              name: organizationName,
              slug,
              email,
              phone,
              status: 'ACTIVE',
            },
          });

          return tx.user.create({
            data: {
              organizationId: organization.id,
              email,
              passwordHash,
              firstName,
              lastName,
              phone,
              role: UserRole.OWNER,
              status: 'ACTIVE',
            },
          });
        });

        const tokens = await this.issueTokens(user.id);
        return {
          user: toRegisteredUser(user),
          ...tokens,
        };
      } catch (error) {
        if (isUniqueConstraintOn(error, 'email')) {
          throw new ConflictException({
            statusCode: 409,
            errors: [{ field: 'email', message: EMAIL_ALREADY_EXISTS_MESSAGE }],
          });
        }
        if (
          isUniqueConstraintOn(error, 'slug') &&
          attempt < MAX_SLUG_ATTEMPTS
        ) {
          continue;
        }
        throw error;
      }
    }
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!user) {
      // Same response regardless of whether the email exists, so the
      // endpoint can't be used to enumerate registered accounts.
      return;
    }

    const secret = randomBytes(32).toString('base64url');
    const tokenHash = await bcrypt.hash(secret, BCRYPT_ROUNDS);

    const resetToken = await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + this.RESET_TOKEN_TTL_MS),
      },
    });

    const token = `${resetToken.id}.${secret}`;
    // TODO: send this via email once a mail provider is wired up.
    console.log(`Password reset token for ${user.email}: ${token}`);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const [tokenId, secret] = token.split('.');
    if (!tokenId || !secret) {
      throw new BadRequestException(INVALID_RESET_TOKEN_MESSAGE);
    }

    const storedToken = await this.prisma.passwordResetToken.findUnique({
      where: { id: tokenId },
    });

    if (
      !storedToken ||
      storedToken.usedAt ||
      storedToken.expiresAt < new Date()
    ) {
      throw new BadRequestException(INVALID_RESET_TOKEN_MESSAGE);
    }

    const secretMatches = await bcrypt.compare(secret, storedToken.tokenHash);
    if (!secretMatches) {
      throw new BadRequestException(INVALID_RESET_TOKEN_MESSAGE);
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: storedToken.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: storedToken.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: storedToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  private async validateRefreshToken(refreshToken: string) {
    const [tokenId, secret] = refreshToken.split('.');
    if (!tokenId || !secret) {
      return null;
    }

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { id: tokenId },
    });

    if (
      !storedToken ||
      storedToken.revokedAt ||
      storedToken.expiresAt < new Date()
    ) {
      return null;
    }

    const secretMatches = await bcrypt.compare(secret, storedToken.tokenHash);
    return secretMatches ? storedToken : null;
  }

  private async issueTokens(userId: string) {
    const accessToken = await this.jwtService.signAsync({ sub: userId });

    const refreshSecret = randomBytes(32).toString('base64url');
    const tokenHash = await bcrypt.hash(refreshSecret, BCRYPT_ROUNDS);

    const refreshTokenRow = await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + this.REFRESH_TOKEN_TTL_MS),
      },
    });

    return {
      accessToken,
      refreshToken: `${refreshTokenRow.id}.${refreshSecret}`,
    };
  }
}
