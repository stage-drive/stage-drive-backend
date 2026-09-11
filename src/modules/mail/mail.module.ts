import { Module } from '@nestjs/common';
import { MailerModule } from '@nestjs-modules/mailer';
import { MailService } from './mail.service';
import { MailController } from './mail.controller';
import { MailConfig } from './mail.config';

@Module({
  imports: [
    MailerModule.forRootAsync({
      extraProviders: [MailConfig],
      inject: [MailConfig],
      useFactory: (mailConfig: MailConfig) => ({
        transport: {
          host: mailConfig.host,
          port: mailConfig.port,
          secure: mailConfig.port === 465,
          auth: {
            user: mailConfig.user,
            pass: mailConfig.password,
          },
        },
        defaults: {
          from: mailConfig.from,
        },
      }),
    }),
  ],
  controllers: [MailController],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
