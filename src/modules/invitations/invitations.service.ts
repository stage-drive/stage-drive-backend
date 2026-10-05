import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Invitation,
  InvitationEmailStatus,
  InvitationStatus,
  Prisma,
  TrainingStatus,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { isUniqueConstraintOn } from '../../common/prisma/unique-constraint';
import { PrismaService } from '../../prisma/prisma.service';
import {
  InvitationEmailDelivery,
  InvitationEmailQueue,
  toEmailDelivery,
} from './invitation-email.queue';
import {
  ADMIN_INVITABLE_ROLES,
  INVALID_OWNER_INVITE_ROLE_MESSAGE,
  InvitationTokenErrorCode,
  InviteByOwnerDto,
  InviteMemberDto,
  OWNER_INVITABLE_ROLES,
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
export const CANCELLED_INVITATION_TOKEN_MESSAGE = 'Це запрошення скасовано.';
export const USED_INVITATION_TOKEN_MESSAGE = 'Це запрошення вже використано.';
export const INVITATION_NOT_FOUND_MESSAGE = 'Запрошення не знайдено.';
export const INVITATION_ALREADY_CANCELLED_MESSAGE =
  'Це запрошення вже скасовано.';
export const INVITATION_ALREADY_USED_MESSAGE = 'Це запрошення вже використано.';

const BCRYPT_ROUNDS = 10;

export { invitationAcceptUrl } from './invitation-email.content';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const invitationEmailPreview = {
  orderBy: { createdAt: 'desc' as const },
  take: 1,
  select: {
    status: true,
    attempts: true,
    lastError: true,
    sentAt: true,
    createdAt: true,
  },
};

function isAdminInvitableRole(role: UserRole): boolean {
  return ADMIN_INVITABLE_ROLES.includes(role);
}

const OWNER_VISIBLE_ROLES: UserRole[] = [
  UserRole.ADMIN,
  UserRole.TEACHER,
  UserRole.INSTRUCTOR,
  UserRole.STUDENT,
];

function visibleRoles(actor: User): UserRole[] {
  if (actor.role === UserRole.OWNER) {
    return OWNER_VISIBLE_ROLES;
  }
  if (actor.role === UserRole.ADMIN) {
    return ADMIN_INVITABLE_ROLES;
  }
  return [];
}

function canCancelRole(actor: User, role: UserRole): boolean {
  if (actor.role === UserRole.OWNER) {
    return role === UserRole.ADMIN;
  }
  return actor.role === UserRole.ADMIN && isAdminInvitableRole(role);
}

function toInvitationView(
  invitation: Invitation,
  emailDelivery?: InvitationEmailDelivery,
) {
  const preview = (
    invitation as Invitation & {
      emailJobs?: Parameters<typeof toEmailDelivery>[0][];
    }
  ).emailJobs?.[0];

  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
    userId: invitation.userId,
    organizationId: invitation.organizationId,
    emailDelivery: emailDelivery ?? toEmailDelivery(preview),
  };
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
    private readonly emailQueue: InvitationEmailQueue,
  ) {}

  async inviteAdmin(owner: User, payload: InviteByOwnerDto) {
    const role = payload.role ?? UserRole.ADMIN;
    if (!OWNER_INVITABLE_ROLES.includes(role)) {
      throw new BadRequestException({
        statusCode: 400,
        errors: [{ field: 'role', message: INVALID_OWNER_INVITE_ROLE_MESSAGE }],
      });
    }

    return this.createAndSendInvitation(owner, {
      ...payload,
      role,
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

  async list(actor: User) {
    const invitations = await this.prisma.invitation.findMany({
      where: {
        organizationId: actor.organizationId,
        role: { in: visibleRoles(actor) },
      },
      orderBy: { createdAt: 'desc' },
      include: { emailJobs: invitationEmailPreview },
    });

    return {
      invitations: invitations.map((invitation) =>
        toInvitationView(invitation),
      ),
    };
  }

  async getById(actor: User, invitationId: string) {
    const invitation = await this.findInvitationForActor(actor, invitationId);
    return toInvitationView(invitation);
  }

  async cancel(actor: User, invitationId: string) {
    const invitation = await this.findInvitationForActor(actor, invitationId, {
      forCancel: true,
    });

    if (invitation.status === InvitationStatus.CANCELLED) {
      throw new BadRequestException({
        statusCode: 400,
        message: INVITATION_ALREADY_CANCELLED_MESSAGE,
      });
    }

    const invitedUser = invitation.user;
    if (
      invitation.status !== InvitationStatus.PENDING ||
      invitation.acceptedAt ||
      !invitedUser ||
      invitedUser.deletedAt ||
      invitedUser.status !== UserStatus.INVITED
    ) {
      throw new BadRequestException({
        statusCode: 400,
        message: INVITATION_ALREADY_USED_MESSAGE,
      });
    }

    const cancelled = await this.prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: InvitationStatus.CANCELLED },
    });
    await this.prisma.invitationEmailJob.updateMany({
      where: {
        invitationId: invitation.id,
        status: {
          in: [
            InvitationEmailStatus.QUEUED,
            InvitationEmailStatus.PROCESSING,
            InvitationEmailStatus.FAILED,
          ],
        },
      },
      data: { status: InvitationEmailStatus.SUPERSEDED, token: null },
    });

    return toInvitationView(cancelled);
  }

  async resend(actor: User, invitationId: string) {
    const invitation = await this.findInvitationForActor(actor, invitationId);
    this.assertInvitationResendable(invitation);

    const token = randomBytes(48).toString('base64url');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.invitation.update({
        where: { id: invitation.id },
        data: {
          tokenHash,
          expiresAt,
          status: InvitationStatus.PENDING,
          acceptedAt: null,
        },
      });
      const emailDelivery = await this.emailQueue.replacePending(tx, {
        invitationId: next.id,
        token,
        tokenHash,
      });
      return { invitation: next, emailDelivery };
    });

    this.emailQueue.kick();
    return toInvitationView(updated.invitation, updated.emailDelivery);
  }

  async verifyToken(rawToken: string): Promise<VerifyInvitationResponseDto> {
    const invitation = await this.findActivatableInvitation(rawToken);

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

  async activate(rawToken: string, password: string) {
    const invitation = await this.findActivatableInvitation(rawToken);
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const acceptedAt = new Date();

    const user = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.invitation.findUnique({
        where: { id: invitation.id },
        include: { user: true, organization: true },
      });
      if (!fresh) {
        throw this.tokenError(
          InvitationTokenErrorCode.INVALID,
          INVALID_INVITATION_TOKEN_MESSAGE,
        );
      }
      this.assertInvitationActivatable(fresh);

      const invitationUpdate = await tx.invitation.updateMany({
        where: {
          id: fresh.id,
          status: InvitationStatus.PENDING,
          acceptedAt: null,
        },
        data: {
          status: InvitationStatus.ACCEPTED,
          acceptedAt,
        },
      });
      if (invitationUpdate.count !== 1) {
        throw this.tokenError(
          InvitationTokenErrorCode.USED,
          USED_INVITATION_TOKEN_MESSAGE,
        );
      }

      const userUpdate = await tx.user.updateMany({
        where: {
          id: fresh.userId,
          status: UserStatus.INVITED,
          deletedAt: null,
        },
        data: {
          passwordHash,
          status: UserStatus.ACTIVE,
        },
      });
      if (userUpdate.count !== 1) {
        throw this.tokenError(
          InvitationTokenErrorCode.USED,
          USED_INVITATION_TOKEN_MESSAGE,
        );
      }

      return tx.user.findUniqueOrThrow({ where: { id: fresh.userId } });
    });

    return {
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        organizationId: user.organizationId,
      },
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        status: InvitationStatus.ACCEPTED,
        acceptedAt,
        userId: invitation.userId,
        organizationId: invitation.organizationId,
      },
    };
  }

  private async findInvitationForActor(
    actor: User,
    invitationId: string,
    options?: { forCancel?: boolean },
  ) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
      include: { user: true, emailJobs: invitationEmailPreview },
    });

    if (!invitation || invitation.organizationId !== actor.organizationId) {
      throw new NotFoundException(INVITATION_NOT_FOUND_MESSAGE);
    }

    const allowed = options?.forCancel
      ? canCancelRole(actor, invitation.role)
      : visibleRoles(actor).includes(invitation.role);
    if (!allowed) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return invitation;
  }

  private async findActivatableInvitation(rawToken: string) {
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

    this.assertInvitationActivatable(invitation);
    return invitation;
  }

  private assertInvitationActivatable(invitation: {
    status: InvitationStatus;
    acceptedAt: Date | null;
    expiresAt: Date;
    user: { status: UserStatus; deletedAt?: Date | null };
    organization: { deletedAt?: Date | null };
  }): void {
    if (invitation.user.deletedAt || invitation.organization.deletedAt) {
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

    if (invitation.status === InvitationStatus.CANCELLED) {
      throw this.tokenError(
        InvitationTokenErrorCode.CANCELLED,
        CANCELLED_INVITATION_TOKEN_MESSAGE,
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
  }

  private assertInvitationResendable(invitation: {
    status: InvitationStatus;
    acceptedAt: Date | null;
    user: { status: UserStatus; deletedAt?: Date | null } | null;
  }): void {
    if (invitation.status === InvitationStatus.CANCELLED) {
      throw new BadRequestException({
        statusCode: 400,
        message: INVITATION_ALREADY_CANCELLED_MESSAGE,
      });
    }

    if (
      invitation.status !== InvitationStatus.PENDING ||
      invitation.acceptedAt ||
      !invitation.user ||
      invitation.user.deletedAt ||
      invitation.user.status !== UserStatus.INVITED
    ) {
      throw new BadRequestException({
        statusCode: 400,
        message: INVITATION_ALREADY_USED_MESSAGE,
      });
    }
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

  private async ensureStudentProfile(
    tx: Prisma.TransactionClient,
    user: { id: string; role: UserRole; organizationId: string },
  ): Promise<string | null> {
    if (user.role !== UserRole.STUDENT) {
      return null;
    }

    const existing = await tx.student.findUnique({
      where: { userId: user.id },
    });
    if (existing) {
      return null;
    }

    const profile = await tx.student.create({
      data: {
        userId: user.id,
        organizationId: user.organizationId,
        instructorId: null,
        carId: null,
        trainingStatus: TrainingStatus.INVITED,
      },
    });
    return profile.id;
  }

  private emailAlreadyExists() {
    return new ConflictException({
      statusCode: 409,
      errors: [{ field: 'email', message: EMAIL_ALREADY_EXISTS_MESSAGE }],
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

    let created: {
      user: User;
      invitation: Invitation;
      emailDelivery: InvitationEmailDelivery;
    };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({ where: { email } });
        if (existing) {
          if (
            existing.deletedAt ||
            existing.status !== UserStatus.INVITED ||
            existing.organizationId !== inviter.organizationId
          ) {
            throw this.emailAlreadyExists();
          }

          const liveInvitation = await tx.invitation.findFirst({
            where: {
              userId: existing.id,
              status: InvitationStatus.PENDING,
              acceptedAt: null,
              expiresAt: { gt: new Date() },
            },
          });

          const user = await tx.user.update({
            where: { id: existing.id },
            data: {
              firstName,
              lastName,
              phone,
              role,
              status: UserStatus.INVITED,
              passwordHash: null,
            },
          });
          await this.ensureStudentProfile(tx, user);

          if (liveInvitation) {
            const invitation = await tx.invitation.update({
              where: { id: liveInvitation.id },
              data: {
                email,
                role,
                tokenHash,
                status: InvitationStatus.PENDING,
                expiresAt,
                acceptedAt: null,
                invitedById: inviter.id,
              },
            });
            const emailDelivery = await this.emailQueue.replacePending(tx, {
              invitationId: invitation.id,
              token,
              tokenHash,
            });
            return { user, invitation, emailDelivery };
          }

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
          const emailDelivery = await this.emailQueue.enqueue(tx, {
            invitationId: invitation.id,
            token,
            tokenHash,
          });
          return { user, invitation, emailDelivery };
        }

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
        await this.ensureStudentProfile(tx, user);

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
        const emailDelivery = await this.emailQueue.enqueue(tx, {
          invitationId: invitation.id,
          token,
          tokenHash,
        });

        return { user, invitation, emailDelivery };
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      if (isUniqueConstraintOn(error, 'email')) {
        throw this.emailAlreadyExists();
      }
      throw error;
    }

    this.emailQueue.kick();

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
      invitation: toInvitationView(created.invitation, created.emailDelivery),
    };
  }
}
