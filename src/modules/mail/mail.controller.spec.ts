import { MailController } from './mail.controller';
import { MailService } from './mail.service';
import { SendMailDto } from './dto/send-mail.dto';

describe('MailController', () => {
  let controller: MailController;
  let mailService: { sendEmail: jest.Mock };

  const dto: SendMailDto = {
    to: 'student@example.com',
    subject: 'Welcome',
    html: '<p>Hello</p>',
  };

  beforeEach(() => {
    mailService = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    controller = new MailController(mailService as unknown as MailService);
  });

  it('delegates to MailService.sendEmail and reports success', async () => {
    const result = await controller.send(dto);

    expect(mailService.sendEmail).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ success: true });
  });

  it('propagates errors from MailService', async () => {
    mailService.sendEmail.mockRejectedValue(new Error('boom'));

    await expect(controller.send(dto)).rejects.toThrow('boom');
  });
});
