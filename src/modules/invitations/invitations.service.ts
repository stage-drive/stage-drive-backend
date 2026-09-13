import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Invitation,
  InvitationStatus,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { isUniqueConstraintOn } from '../../common/prisma/unique-constraint';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { InviteAdminDto } from './invitations.dto';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const EMAIL_ALREADY_EXISTS_MESSAGE =
  'Користувач з таким email уже існує.';

const DEFAULT_FRONTEND_URL = 'http://localhost:5173';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function frontendBaseUrl(): string {
  const fromEnv = (
    process.env.FRONTEND_URL ??
    process.env.GOOGLE_OAUTH_SUCCESS_REDIRECT ??
    DEFAULT_FRONTEND_URL
  ).trim();
  return (fromEnv || DEFAULT_FRONTEND_URL).replace(/\/$/, '');
}

export function invitationAcceptUrl(token: string): string {
  return `${frontendBaseUrl()}/invite?token=${encodeURIComponent(token)}`;
}

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async inviteAdmin(owner: User, payload: InviteAdminDto) {
    const firstName = payload.firstName.trim();
    const lastName = payload.lastName.trim();
    const email = payload.email.trim().toLowerCase();
    const phone = payload.phone?.trim() || null;

    const organization = await this.prisma.organization.findUnique({
      where: { id: owner.organizationId },
    });
    if (!organization || organization.deletedAt) {
      throw new NotFoundException('Organization not found');
    }

    const token = randomBytes(48).toString('base64url');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    let created: { user: User; invitation: Invitation };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            firstName,
            lastName,
            phone,
            passwordHash: null,
            role: UserRole.ADMIN,
            status: UserStatus.INVITED,
            organizationId: owner.organizationId,
          },
        });

        const invitation = await tx.invitation.create({
          data: {
            email,
            role: UserRole.ADMIN,
            tokenHash,
            status: InvitationStatus.PENDING,
            expiresAt,
            invitedById: owner.id,
            userId: user.id,
            organizationId: owner.organizationId,
          },
        });

        return { user, invitation };
      });
    } catch (error) {
      if (isUniqueConstraintOn(error, 'email')) {
        throw new ConflictException({
          statusCode: 409,
          errors: [{ field: 'email', message: EMAIL_ALREADY_EXISTS_MESSAGE }],
        });
      }
      throw error;
    }

    try {
      await this.mailService.sendEmail({
        to: email,
        subject: `Запрошення стати адміністратором — ${organization.name}`,
        html: this.buildInvitationHtml({
          firstName,
          organizationName: organization.name,
          ownerName: `${owner.firstName} ${owner.lastName}`.trim(),
          acceptUrl: invitationAcceptUrl(token),
          expiresAt,
        }),
      });
    } catch (error) {
      await this.prisma.user
        .delete({ where: { id: created.user.id } })
        .catch(() => undefined);
      throw error;
    }

    return {
      user: {
        id: created.user.id,
        firstName: created.user.firstName,
        lastName: created.user.lastName,
        email: created.user.email,
        phone: created.user.phone,
        role: created.user.role,
        status: created.user.status,
        organizationId: created.user.organizationId,
      },
      invitation: {
        id: created.invitation.id,
        email: created.invitation.email,
        role: created.invitation.role,
        status: created.invitation.status,
        expiresAt: created.invitation.expiresAt,
        userId: created.invitation.userId,
        organizationId: created.invitation.organizationId,
      },
    };
  }

  private buildInvitationHtml(input: {
    firstName: string;
    organizationName: string;
    ownerName: string;
    acceptUrl: string;
    expiresAt: Date;
  }): string {
    const firstName = escapeHtml(input.firstName);
    const organizationName = escapeHtml(input.organizationName);
    const ownerName = escapeHtml(input.ownerName);
    const acceptUrl = escapeHtml(input.acceptUrl);
    const expiresAt = escapeHtml(
      input.expiresAt.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' }),
    );

    return `
<p>Вітаємо, ${firstName}!</p>
<p>${ownerName} запрошує вас стати адміністратором автошколи «${organizationName}».</p>
<p>Щоб прийняти запрошення, перейдіть за посиланням:<br />
<a href="${acceptUrl}">${acceptUrl}</a></p>
<p>Посилання дійсне до ${expiresAt}.</p>
`.trim();
  }
}
