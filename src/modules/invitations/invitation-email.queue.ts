import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  InvitationEmailStatus,
  InvitationStatus,
  Prisma,
  UserStatus,
} from '@prisma/client';
import { MailSendFailedError, MailService } from '../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildInvitationEmail,
  invitationAcceptUrl,
  invitationRoleTitle,
} from './invitation-email.content';

export const INVITATION_EMAIL_MAX_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 5_000;
const STUCK_PROCESSING_MS = 2 * 60 * 1000;

export type InvitationEmailDeliveryStatus =
  'NONE' | 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED';

export type InvitationEmailDelivery = {
  status: InvitationEmailDeliveryStatus;
  attempts: number;
  lastError: string | null;
  sentAt: Date | null;
  queuedAt: Date | null;
};

export const NO_EMAIL_DELIVERY: InvitationEmailDelivery = {
  status: 'NONE',
  attempts: 0,
  lastError: null,
  sentAt: null,
  queuedAt: null,
};

type EmailJobPreview = {
  status: InvitationEmailStatus;
  attempts: number;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
};

type ClaimedJob = {
  id: string;
  invitation_id: string;
  token: string | null;
  token_hash: string;
  attempts: number;
};

export function toEmailDelivery(
  job: EmailJobPreview | null | undefined,
): InvitationEmailDelivery {
  if (!job || job.status === InvitationEmailStatus.SUPERSEDED) {
    return NO_EMAIL_DELIVERY;
  }

  const status: InvitationEmailDeliveryStatus =
    job.status === InvitationEmailStatus.PROCESSING ? 'SENDING' : job.status;

  return {
    status,
    attempts: job.attempts,
    lastError: job.lastError,
    sentAt: job.sentAt,
    queuedAt: job.createdAt,
  };
}

function isClaimedJob(value: unknown): value is ClaimedJob {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const row = value as Partial<ClaimedJob>;
  return (
    typeof row.id === 'string' &&
    typeof row.invitation_id === 'string' &&
    typeof row.token_hash === 'string' &&
    typeof row.attempts === 'number' &&
    (typeof row.token === 'string' || row.token === null)
  );
}

function retryDelayMs(attempts: number): number {
  if (attempts <= 1) {
    return 15_000;
  }
  return 60_000;
}

function unknownError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === 'string') {
    return new Error(error);
  }
  return new Error('Unknown error');
}

function deliveryReason(error: unknown): string {
  if (error instanceof MailSendFailedError) {
    return error.reason;
  }
  return unknownError(error).message.replace(/\s+/g, ' ').slice(0, 500);
}

@Injectable()
export class InvitationEmailQueue
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(InvitationEmailQueue.name);
  private timer: NodeJS.Timeout | null = null;
  private pumping = false;
  private pumpAgain = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.recoverStuck();
    } catch (error) {
      const err = unknownError(error);
      this.logger.error(
        `Failed to recover stuck invitation emails: ${err.message}`,
        err.stack,
      );
    }
    this.timer = setInterval(() => {
      this.kick();
    }, POLL_INTERVAL_MS);
    this.timer.unref();
    this.kick();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async enqueue(
    tx: Prisma.TransactionClient,
    input: { invitationId: string; token: string; tokenHash: string },
  ): Promise<InvitationEmailDelivery> {
    const job = await tx.invitationEmailJob.create({
      data: {
        invitationId: input.invitationId,
        token: input.token,
        tokenHash: input.tokenHash,
        status: InvitationEmailStatus.QUEUED,
        nextAttemptAt: new Date(),
      },
    });
    return toEmailDelivery(job);
  }

  async replacePending(
    tx: Prisma.TransactionClient,
    input: { invitationId: string; token: string; tokenHash: string },
  ): Promise<InvitationEmailDelivery> {
    await tx.invitationEmailJob.updateMany({
      where: {
        invitationId: input.invitationId,
        status: {
          in: [
            InvitationEmailStatus.QUEUED,
            InvitationEmailStatus.PROCESSING,
            InvitationEmailStatus.FAILED,
          ],
        },
      },
      data: {
        status: InvitationEmailStatus.SUPERSEDED,
        token: null,
      },
    });
    return this.enqueue(tx, input);
  }

  kick(): void {
    void this.pump();
  }

  private async recoverStuck(): Promise<void> {
    await this.prisma.invitationEmailJob.updateMany({
      where: {
        status: InvitationEmailStatus.PROCESSING,
        updatedAt: { lt: new Date(Date.now() - STUCK_PROCESSING_MS) },
      },
      data: {
        status: InvitationEmailStatus.QUEUED,
        nextAttemptAt: new Date(),
      },
    });
  }

  private async pump(): Promise<void> {
    if (this.pumping) {
      this.pumpAgain = true;
      return;
    }

    this.pumping = true;
    try {
      for (;;) {
        this.pumpAgain = false;
        let job: ClaimedJob | null = null;
        try {
          job = await this.claimNext();
        } catch (error) {
          const err = unknownError(error);
          this.logger.error(
            `Failed to claim invitation email job: ${err.message}`,
            err.stack,
          );
          break;
        }
        if (!job) {
          break;
        }
        try {
          await this.dispatch(job);
        } catch (error) {
          const err = unknownError(error);
          this.logger.error(
            `Invitation email job ${job.id} crashed: ${err.message}`,
            err.stack,
          );
        }
      }
    } finally {
      this.pumping = false;
      if (this.pumpAgain) {
        this.pumpAgain = false;
        void this.pump();
      }
    }
  }

  private async claimNext(): Promise<ClaimedJob | null> {
    const rows = await this.prisma.$queryRaw<unknown[]>`
      UPDATE invitation_email_jobs
      SET status = 'PROCESSING'::"InvitationEmailStatus",
          attempts = attempts + 1,
          updated_at = NOW()
      WHERE id = (
        SELECT id
        FROM invitation_email_jobs
        WHERE status = 'QUEUED'::"InvitationEmailStatus"
          AND next_attempt_at <= NOW()
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, invitation_id, token, token_hash, attempts
    `;
    if (!Array.isArray(rows) || rows.length === 0 || !isClaimedJob(rows[0])) {
      return null;
    }
    return rows[0];
  }

  private async dispatch(claimed: ClaimedJob): Promise<void> {
    const job = await this.prisma.invitationEmailJob.findUnique({
      where: { id: claimed.id },
    });
    if (!job || job.status !== InvitationEmailStatus.PROCESSING || !job.token) {
      return;
    }

    const invitation = await this.prisma.invitation.findUnique({
      where: { id: job.invitationId },
      include: {
        user: true,
        organization: true,
        invitedBy: { select: { firstName: true, lastName: true } },
      },
    });

    if (
      !invitation ||
      invitation.organization.deletedAt ||
      invitation.user.deletedAt
    ) {
      await this.finish(job.id, {
        status: InvitationEmailStatus.FAILED,
        token: null,
        lastError: 'Запрошення більше не можна доставити.',
      });
      return;
    }

    if (
      invitation.status !== InvitationStatus.PENDING ||
      invitation.tokenHash !== job.tokenHash ||
      invitation.user.status !== UserStatus.INVITED
    ) {
      await this.finish(job.id, {
        status: InvitationEmailStatus.SUPERSEDED,
        token: null,
      });
      return;
    }

    const freshJob = await this.prisma.invitationEmailJob.findUnique({
      where: { id: job.id },
    });
    if (!freshJob || freshJob.status !== InvitationEmailStatus.PROCESSING) {
      return;
    }
    if (!freshJob.token || freshJob.tokenHash !== invitation.tokenHash) {
      await this.finish(job.id, {
        status: InvitationEmailStatus.SUPERSEDED,
        token: null,
      });
      return;
    }

    const acceptUrl = invitationAcceptUrl(freshJob.token);
    const roleTitle = invitationRoleTitle(invitation.role);
    const message = buildInvitationEmail({
      firstName: invitation.user.firstName,
      organizationName: invitation.organization.name,
      inviterName:
        `${invitation.invitedBy.firstName} ${invitation.invitedBy.lastName}`.trim(),
      roleTitle,
      acceptUrl,
      expiresAt: invitation.expiresAt,
    });

    try {
      const sent = await this.mailService.sendEmail({
        to: invitation.email,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      await this.finish(job.id, {
        status: InvitationEmailStatus.SENT,
        token: null,
        lastError: null,
        sentAt: new Date(),
        providerMessageId: sent.messageId || null,
      });
      this.logger.log(
        `Invitation email accepted by SMTP invitationId=${invitation.id} messageId=${sent.messageId || 'n/a'}`,
      );
    } catch (error) {
      const reason = deliveryReason(error);
      const giveUp = freshJob.attempts >= INVITATION_EMAIL_MAX_ATTEMPTS;
      await this.finish(job.id, {
        status: giveUp
          ? InvitationEmailStatus.FAILED
          : InvitationEmailStatus.QUEUED,
        lastError: reason,
        token: giveUp ? null : freshJob.token,
        nextAttemptAt: giveUp
          ? freshJob.nextAttemptAt
          : new Date(Date.now() + retryDelayMs(freshJob.attempts)),
      });
      this.logger.error(
        `Invitation email failed invitationId=${invitation.id} attempt=${freshJob.attempts}: ${reason}`,
      );
    }
  }

  private async finish(
    id: string,
    data: Prisma.InvitationEmailJobUpdateInput,
  ): Promise<void> {
    await this.prisma.invitationEmailJob.update({
      where: { id },
      data,
    });
  }
}
