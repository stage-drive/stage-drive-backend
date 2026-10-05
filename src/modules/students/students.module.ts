import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InvitationsModule } from '../invitations/invitations.module';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

@Module({
  imports: [AuthModule, InvitationsModule],
  controllers: [StudentsController],
  providers: [StudentsService],
})
export class StudentsModule {}
