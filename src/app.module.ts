import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './modules/mail/mail.module';

@Module({
  imports: [PrismaModule, AuthModule, UsersModule, OrganizationModule, MailModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
