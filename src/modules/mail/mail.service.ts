import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { SendMailDto } from './dto/send-mail.dto';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly mailerService: MailerService) {}

  async sendEmail(dto: SendMailDto): Promise<void> {
    try {
      await this.mailerService.sendMail({
        to: dto.to,
        subject: dto.subject,
        html: dto.html,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to send email to ${dto.to}: ${err.message}`, err.stack);
      throw new InternalServerErrorException('Failed to send email');
    }
  }
}
