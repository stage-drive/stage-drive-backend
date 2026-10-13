import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { isUniqueConstraintOn } from '../../common/prisma/unique-constraint';
import { PrismaService } from '../../prisma/prisma.service';
import { RefreshTokenService } from '../auth/refresh-token.service';
import { MailService } from '../mail/mail.service';
import {
  buildEmailChangeConfirmEmail,
  buildEmailChangedNotice,
  emailChangeConfirmUrl,
} from './email-change.content';

export const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000;
export const EMAIL_CHANGE_COOLDOWN_MS = 60 * 1000;
export const INVALID_EMAIL_CHANGE_TOKEN_MESSAGE =
  'Посилання для підтвердження email недійсне або застаріле.';
export const SAME_EMAIL_MESSAGE = 'Новий email збігається з поточним.';
export const PASSWORD_REQUIRED_MESSAGE =
  'Щоб змінити email, спершу встановіть пароль через «Забули пароль?».';
export const EMAIL_CHANGE_COOLDOWN_MESSAGE =
  'Зачекайте хвилину перед повторним запитом.';
const CURRENT_PASSWORD_INCORRECT_MESSAGE = 'Current password is incorrect';
const EMAIL_ALREADY_EXISTS_MESSAGE = 'Користувач з таким email уже існує.';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class EmailChangeService {
  private readonly logger = new Logger(EmailChangeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  async requestEmailChange(
    user: User,
    newEmail: string,
    currentPassword: string,
  ) {
    const email = newEmail.trim().toLowerCase();
    if (email === user.email.toLowerCase()) {
      throw new BadRequestException(SAME_EMAIL_MESSAGE);
    }

    const fresh = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!fresh) {
      throw new NotFoundException('User not found');
    }
    // Google-only акаунт: без пароля немає чим підтвердити, що запит робить власник.
    if (!fresh.passwordHash) {
      throw new BadRequestException(PASSWORD_REQUIRED_MESSAGE);
    }
    const matches = await bcrypt.compare(currentPassword, fresh.passwordHash);
    if (!matches) {
      throw new BadRequestException(CURRENT_PASSWORD_INCORRECT_MESSAGE);
    }

    const taken = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (taken) {
      throw this.emailAlreadyExists();
    }

    const recent = await this.prisma.emailChangeToken.findFirst({
      where: {
        userId: user.id,
        createdAt: { gt: new Date(Date.now() - EMAIL_CHANGE_COOLDOWN_MS) },
      },
      select: { id: true },
    });
    if (recent) {
      throw new HttpException(
        EMAIL_CHANGE_COOLDOWN_MESSAGE,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.prisma.emailChangeToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = randomBytes(48).toString('base64url');
    const record = await this.prisma.emailChangeToken.create({
      data: {
        userId: user.id,
        newEmail: email,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + EMAIL_CHANGE_TTL_MS),
      },
    });

    try {
      await this.mailService.sendEmail({
        to: email,
        ...buildEmailChangeConfirmEmail(emailChangeConfirmUrl(token)),
      });
    } catch (error) {
      // Лист не дійшов — токен нікому не відомий; прибираємо його, щоб cooldown не блокував повтор.
      await this.prisma.emailChangeToken
        .delete({ where: { id: record.id } })
        .catch(() => undefined);
      throw error;
    }

    this.logger.log(`Email change requested userId=${user.id}`);
    return { message: 'Лист для підтвердження надіслано на нову адресу.' };
  }

  async verifyEmailChange(user: User, token: string) {
    const record = await this.prisma.emailChangeToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });

    if (
      !record ||
      record.userId !== user.id ||
      record.usedAt ||
      record.expiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException(INVALID_EMAIL_CHANGE_TOKEN_MESSAGE);
    }

    const now = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        const consumed = await tx.emailChangeToken.updateMany({
          where: { id: record.id, usedAt: null },
          data: { usedAt: now },
        });
        if (consumed.count !== 1) {
          throw new BadRequestException(INVALID_EMAIL_CHANGE_TOKEN_MESSAGE);
        }

        await tx.user.update({
          where: { id: user.id },
          data: { email: record.newEmail, tokensInvalidBefore: now },
        });
        await tx.emailChangeToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: now },
        });
      });
    } catch (error) {
      if (isUniqueConstraintOn(error, 'email')) {
        throw this.emailAlreadyExists();
      }
      throw error;
    }

    await this.refreshTokenService.revokeAllForUser(user.id);
    await this.notifyPreviousEmail(user.id, user.email, record.newEmail);

    this.logger.log(`Email changed userId=${user.id}`);
    return { message: 'Email оновлено. Увійдіть знову з новою адресою.' };
  }

  private async notifyPreviousEmail(
    userId: string,
    previousEmail: string,
    newEmail: string,
  ): Promise<void> {
    try {
      await this.mailService.sendEmail({
        to: previousEmail,
        ...buildEmailChangedNotice(newEmail),
      });
    } catch (error) {
      this.logger.warn(
        `Email changed but previous address was not notified userId=${userId}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  private emailAlreadyExists() {
    return new ConflictException({
      statusCode: 409,
      errors: [{ field: 'email', message: EMAIL_ALREADY_EXISTS_MESSAGE }],
    });
  }
}
