import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './modules/mail/mail.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { StudentsModule } from './modules/students/students.module';
import { CarsModule } from './modules/cars/cars.module';
import { GroupsModule } from './modules/groups/groups.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UsersModule,
    OrganizationModule,
    MailModule,
    InvitationsModule,
    DashboardModule,
    StudentsModule,
    CarsModule,
    GroupsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
