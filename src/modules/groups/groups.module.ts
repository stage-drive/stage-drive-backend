import { Module } from '@nestjs/common';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { AuthModule } from '../auth/auth.module';
import { StudentsModule } from '../students/students.module';

@Module({
  imports: [AuthModule, StudentsModule],
  controllers: [GroupsController],
  providers: [GroupsService],
})
export class GroupsModule {}
