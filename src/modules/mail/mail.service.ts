import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { SendMailDto } from './dto/send-mail.dto';

export class MailSendFailedError extends InternalServerErrorException {
  readonly reason: string;

  constructor(reason: string) {
    super('Failed to send email');
    this.reason = reason;
  }
}

type SentMailInfo = {
  messageId?: string;
  response?: string;
  rejected?: Array<string | { address?: string }>;
};

export type MailSendResult = {
  messageId: string;
};

function unknownError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === 'string') {
    return new Error(error);
  }
  return new Error('Unknown error');
}

function safeReason(error: unknown): string {
  return unknownError(error).message.replace(/\s+/g, ' ').slice(0, 500);
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly mailerService: MailerService) {}

  async sendEmail(
    dto: SendMailDto & { text?: string },
  ): Promise<MailSendResult> {
    try {
      const info = (await this.mailerService.sendMail({
        to: dto.to,
        subject: dto.subject,
        html: dto.html,
        ...(dto.text ? { text: dto.text } : {}),
      })) as SentMailInfo | undefined;
      const rejected = (info?.rejected ?? [])
        .map((item) => (typeof item === 'string' ? item : item.address))
        .filter((address): address is string => Boolean(address));
      if (rejected.length > 0) {
        throw new Error(`SMTP rejected recipient: ${rejected.join(', ')}`);
      }
      const messageId =
        typeof info?.messageId === 'string' ? info.messageId : '';
      const response = typeof info?.response === 'string' ? info.response : '';
      this.logger.log(
        `SMTP accepted email to ${dto.to} messageId=${messageId || 'n/a'} response=${response || 'n/a'}`,
      );
      return { messageId };
    } catch (error) {
      if (error instanceof MailSendFailedError) {
        throw error;
      }
      const err = unknownError(error);
      const reason = safeReason(err);
      this.logger.error(
        `Failed to send email to ${dto.to}: ${reason}`,
        err.stack,
      );
      throw new MailSendFailedError(reason);
    }
  }
}
