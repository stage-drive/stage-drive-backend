import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LessonAttendanceService } from './lesson-attendance.service';
import { LessonsController } from './lessons.controller';
import { LessonsService } from './lessons.service';
import { PersonalScheduleService } from './personal-schedule.service';

@Module({
  imports: [AuthModule],
  controllers: [LessonsController],
  providers: [LessonsService, PersonalScheduleService, LessonAttendanceService],
})
export class LessonsModule {}
