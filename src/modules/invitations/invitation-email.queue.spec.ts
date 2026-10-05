import {
  InvitationEmailStatus,
  InvitationStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { MailSendFailedError, MailService } from '../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InvitationEmailQueue } from './invitation-email.queue';

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('InvitationEmailQueue', () => {
  const invitation = {
    id: 'invite-1',
    email: 'person@example.com',
    role: UserRole.ADMIN,
    status: InvitationStatus.PENDING,
    tokenHash: 'hash-1',
    expiresAt: new Date('2026-10-12T00:00:00.000Z'),
    user: {
      firstName: 'Олена',
      lastName: 'Коваль',
      status: UserStatus.INVITED,
      deletedAt: null,
    },
    organization: { name: 'Автошкола Drive', deletedAt: null },
    invitedBy: { firstName: 'Іван', lastName: 'Петренко' },
  };

  const processingJob = {
    id: 'job-1',
    invitationId: 'invite-1',
    status: InvitationEmailStatus.PROCESSING,
    token: 'raw-token',
    tokenHash: 'hash-1',
    attempts: 1,
    nextAttemptAt: new Date('2026-10-05T10:00:00.000Z'),
  };

  let prisma: {
    $queryRaw: jest.Mock;
    invitation: { findUnique: jest.Mock };
    invitationEmailJob: {
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      create: jest.Mock;
    };
  };
  let mail: { sendEmail: jest.Mock };
  let queue: InvitationEmailQueue;

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      invitation: { findUnique: jest.fn().mockResolvedValue(invitation) },
      invitationEmailJob: {
        findUnique: jest.fn().mockResolvedValue(processingJob),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({
          ...processingJob,
          status: InvitationEmailStatus.QUEUED,
          attempts: 0,
          lastError: null,
          sentAt: null,
          createdAt: new Date('2026-10-05T10:00:00.000Z'),
        }),
      },
    };
    mail = {
      sendEmail: jest.fn().mockResolvedValue({ messageId: '<abc@gmail>' }),
    };
    queue = new InvitationEmailQueue(
      prisma as unknown as PrismaService,
      mail as unknown as MailService,
    );
  });

  it('ignores rows that are not invitation email jobs', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);

    queue.kick();
    await flush();

    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it('sends a claimed job and clears the raw token after SMTP accepts it', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: 'job-1',
        invitation_id: 'invite-1',
        token: 'raw-token',
        token_hash: 'hash-1',
        attempts: 1,
      },
    ]);

    queue.kick();
    await flush();

    expect(mail.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'person@example.com',
        subject: 'Запрошення стати адміністратором — Автошкола Drive',
        html: expect.stringContaining('invite?token=raw-token'),
        text: expect.stringContaining('invite?token=raw-token'),
      }),
    );
    expect(prisma.invitationEmailJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({
        status: InvitationEmailStatus.SENT,
        token: null,
        providerMessageId: '<abc@gmail>',
      }),
    });
  });

  it('requeues a failed attempt and stores the SMTP reason', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: 'job-1',
        invitation_id: 'invite-1',
        token: 'raw-token',
        token_hash: 'hash-1',
        attempts: 1,
      },
    ]);
    mail.sendEmail.mockRejectedValue(
      new MailSendFailedError('535 Username and Password not accepted'),
    );

    queue.kick();
    await flush();

    expect(prisma.invitationEmailJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({
        status: InvitationEmailStatus.QUEUED,
        lastError: '535 Username and Password not accepted',
        token: 'raw-token',
      }),
    });
  });

  it('marks the job failed after the last attempt and drops the token', async () => {
    prisma.invitationEmailJob.findUnique.mockResolvedValue({
      ...processingJob,
      attempts: 3,
    });
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: 'job-1',
        invitation_id: 'invite-1',
        token: 'raw-token',
        token_hash: 'hash-1',
        attempts: 3,
      },
    ]);
    mail.sendEmail.mockRejectedValue(
      new MailSendFailedError('connection refused'),
    );

    queue.kick();
    await flush();

    expect(prisma.invitationEmailJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({
        status: InvitationEmailStatus.FAILED,
        lastError: 'connection refused',
        token: null,
      }),
    });
  });

  it('does not send when the invitation token was rotated', async () => {
    prisma.invitation.findUnique.mockResolvedValue({
      ...invitation,
      tokenHash: 'newer-hash',
    });
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        id: 'job-1',
        invitation_id: 'invite-1',
        token: 'raw-token',
        token_hash: 'hash-1',
        attempts: 1,
      },
    ]);

    queue.kick();
    await flush();

    expect(mail.sendEmail).not.toHaveBeenCalled();
    expect(prisma.invitationEmailJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: {
        status: InvitationEmailStatus.SUPERSEDED,
        token: null,
      },
    });
  });
});
