import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import {
  ADMIN_INVITABLE_ROLES,
  InvitationTokenErrorCode,
  InviteAdminDto,
  InviteMemberDto,
  VerifyInvitationResponseDto,
} from './invitations.dto';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const EMAIL_ALREADY_EXISTS_MESSAGE =
  'Користувач з таким email уже існує.';
export const ADMIN_CANNOT_INVITE_PRIVILEGED_ROLE_MESSAGE =
  'ADMIN не може запрошувати користувачів з роллю OWNER або ADMIN.';
export const INVALID_INVITATION_TOKEN_MESSAGE =
  'Посилання-запрошення недійсне.';
export const EXPIRED_INVITATION_TOKEN_MESSAGE =
  'Посилання-запрошення прострочене.';
export const USED_INVITATION_TOKEN_MESSAGE =
  'Це запрошення вже використано.';

const DEFAULT_FRONTEND_URL = 'http://localhost:5173';

const ROLE_TITLE_UK: Record<UserRole, string> = {
  [UserRole.OWNER]: 'власником',
  [UserRole.ADMIN]: 'адміністратором',
  [UserRole.TEACHER]: 'викладачем',
  [UserRole.INSTRUCTOR]: 'інструктором',
  [UserRole.STUDENT]: 'учнем',
};

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

function isAdminInvitableRole(role: UserRole): boolean {
  return ADMIN_INVITABLE_ROLES.includes(role);
}

type InviteUserPayload = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  role: UserRole;
};

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async inviteAdmin(owner: User, payload: InviteAdminDto) {
    return this.createAndSendInvitation(owner, {
      ...payload,
      role: UserRole.ADMIN,
    });
  }

  async inviteMember(admin: User, payload: InviteMemberDto) {
    if (admin.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Insufficient permissions');
    }
    if (!isAdminInvitableRole(payload.role)) {
      throw new ForbiddenException(ADMIN_CANNOT_INVITE_PRIVILEGED_ROLE_MESSAGE);
    }

    return this.createAndSendInvitation(admin, payload);
  }

  async verifyToken(rawToken: string): Promise<VerifyInvitationResponseDto> {
    const token = rawToken.trim();
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true, organization: true },
    });

    if (!invitation) {
      throw this.tokenError(
        InvitationTokenErrorCode.INVALID,
        INVALID_INVITATION_TOKEN_MESSAGE,
      );
    }

    if (this.isInvitationUsed(invitation)) {
      throw this.tokenError(
        InvitationTokenErrorCode.USED,
        USED_INVITATION_TOKEN_MESSAGE,
      );
    }

    if (invitation.status !== InvitationStatus.PENDING) {
      throw this.tokenError(
        InvitationTokenErrorCode.INVALID,
        INVALID_INVITATION_TOKEN_MESSAGE,
      );
    }

    if (invitation.expiresAt.getTime() < Date.now()) {
      throw this.tokenError(
        InvitationTokenErrorCode.EXPIRED,
        EXPIRED_INVITATION_TOKEN_MESSAGE,
      );
    }

    return {
      valid: true,
      email: invitation.email,
      firstName: invitation.user.firstName,
      lastName: invitation.user.lastName,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      organizationName: invitation.organization.name,
      organizationId: invitation.organizationId,
    };
  }

  private isInvitationUsed(invitation: {
    status: InvitationStatus;
    acceptedAt: Date | null;
    user: { status: UserStatus };
  }): boolean {
    return (
      invitation.status === InvitationStatus.ACCEPTED ||
      invitation.acceptedAt != null ||
      invitation.user.status !== UserStatus.INVITED
    );
  }

  private tokenError(code: InvitationTokenErrorCode, message: string) {
    return new BadRequestException({
      statusCode: 400,
      code,
      message,
    });
  }

  private async createAndSendInvitation(
    inviter: User,
    payload: InviteUserPayload,
  ) {
    const firstName = payload.firstName.trim();
    const lastName = payload.lastName.trim();
    const email = payload.email.trim().toLowerCase();
    const phone = payload.phone?.trim() || null;
    const role = payload.role;

    const organization = await this.prisma.organization.findUnique({
      where: { id: inviter.organizationId },
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
            role,
            status: UserStatus.INVITED,
            organizationId: inviter.organizationId,
          },
        });

        const invitation = await tx.invitation.create({
          data: {
            email,
            role,
            tokenHash,
            status: InvitationStatus.PENDING,
            expiresAt,
            invitedById: inviter.id,
            userId: user.id,
            organizationId: inviter.organizationId,
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

    const roleTitle = ROLE_TITLE_UK[role];

    try {
      await this.mailService.sendEmail({
        to: email,
        subject: `Запрошення стати ${roleTitle} — ${organization.name}`,
        html: this.buildInvitationHtml({
          firstName,
          organizationName: organization.name,
          inviterName: `${inviter.firstName} ${inviter.lastName}`.trim(),
          roleTitle,
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
    inviterName: string;
    roleTitle: string;
    acceptUrl: string;
    expiresAt: Date;
  }): string {
    const firstName = escapeHtml(input.firstName);
    const organizationName = escapeHtml(input.organizationName);
    const inviterName = escapeHtml(input.inviterName);
    const roleTitle = escapeHtml(input.roleTitle);
    const acceptUrl = escapeHtml(input.acceptUrl);
    const expiresAt = escapeHtml(
      input.expiresAt.toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' }),
    );

    return `
<p>Вітаємо, ${firstName}!</p>
<p>${inviterName} запрошує вас стати ${roleTitle} автошколи «${organizationName}».</p>
<p>Щоб прийняти запрошення, перейдіть за посиланням:<br />
<a href="${acceptUrl}">${acceptUrl}</a></p>
<p>Посилання дійсне до ${expiresAt}.</p>
`.trim();
  }
}
