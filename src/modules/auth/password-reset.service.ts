import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RefreshTokenService } from './refresh-token.service';

const BCRYPT_ROUNDS = 10;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const DEFAULT_FRONTEND_URL = 'http://localhost:5173';
const INVALID_RESET_TOKEN_MESSAGE =
  'Посилання для скидання пароля недійсне або застаріле.';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function frontendBaseUrl(): string {
  const fromEnv = (
    process.env.FRONTEND_URL ??
    process.env.GOOGLE_OAUTH_SUCCESS_REDIRECT ??
    DEFAULT_FRONTEND_URL
  ).trim();
  return (fromEnv || DEFAULT_FRONTEND_URL).replace(/\/$/, '');
}

function passwordResetUrl(token: string): string {
  return `${frontendBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
}

@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  async requestPasswordReset(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    const genericResponse = {
      message: 'Якщо акаунт із таким email існує, лист надіслано.',
    };

    if (!user || user.deletedAt) {
      return genericResponse;
    }

    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = randomBytes(48).toString('base64url');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
      },
    });

    await this.mailService.sendEmail({
      to: user.email,
      subject: 'Відновлення пароля',
      html: `
        <p>Щоб скинути пароль, перейдіть за посиланням:<br />
        <a href="${passwordResetUrl(token)}">${passwordResetUrl(token)}</a></p>
        <p>Посилання дійсне 30 хвилин.</p>
      `.trim(),
    });

    return genericResponse;
  }

  async resetPassword(token: string, newPassword: string) {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });

    if (!record || record.expiresAt.getTime() < Date.now() || record.usedAt) {
      throw new UnauthorizedException(INVALID_RESET_TOKEN_MESSAGE);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: record.userId },
    });
    if (!user) {
      throw new UnauthorizedException(INVALID_RESET_TOKEN_MESSAGE);
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        tokensInvalidBefore: new Date(),
        status:
          user.status === UserStatus.INVITED
            ? UserStatus.ACTIVE
            : user.status,
      },
    });

    await this.prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });

    await this.refreshTokenService.revokeAllForUser(user.id);

    return { message: 'Пароль оновлено.' };
  }
}