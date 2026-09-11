import { InternalServerErrorException, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { MailService } from './mail.service';
import { SendMailDto } from './dto/send-mail.dto';

describe('MailService', () => {
  let service: MailService;
  let mailerService: { sendMail: jest.Mock };

  const dto: SendMailDto = {
    to: 'student@example.com',
    subject: 'Welcome',
    html: '<p>Hello</p>',
  };

  beforeEach(() => {
    mailerService = { sendMail: jest.fn().mockResolvedValue(undefined) };
    service = new MailService(mailerService as unknown as MailerService);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends mail via MailerService with the DTO fields', async () => {
    await service.sendEmail(dto);

    expect(mailerService.sendMail).toHaveBeenCalledWith({
      to: dto.to,
      subject: dto.subject,
      html: dto.html,
    });
  });

  it('wraps a transport failure in an InternalServerErrorException', async () => {
    mailerService.sendMail.mockRejectedValue(
      new Error('SMTP connection refused'),
    );

    await expect(service.sendEmail(dto)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('does not leak the underlying error message to the caller', async () => {
    mailerService.sendMail.mockRejectedValue(
      new Error('secret smtp password wrong'),
    );

    await expect(service.sendEmail(dto)).rejects.toMatchObject({
      message: 'Failed to send email',
    });
  });

  it('logs the underlying error instead of swallowing it', async () => {
    const error = new Error('SMTP connection refused');
    mailerService.sendMail.mockRejectedValue(error);

    await expect(service.sendEmail(dto)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining(dto.to),
      error.stack,
    );
  });
});
