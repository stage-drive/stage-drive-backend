import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InstructorScheduleController } from './instructor-schedule.controller';
import { InstructorScheduleService } from './instructor-schedule.service';
import { LessonAttendanceService } from './lesson-attendance.service';
import { LessonsController } from './lessons.controller';
import { LessonsService } from './lessons.service';
import { PersonalScheduleService } from './personal-schedule.service';
import { PracticeSlotsController } from './practice-slots.controller';
import { PracticeSlotsService } from './practice-slots.service';

@Module({
  imports: [AuthModule],
  controllers: [
    LessonsController,
    PracticeSlotsController,
    InstructorScheduleController,
  ],
  providers: [
    LessonsService,
    PersonalScheduleService,
    LessonAttendanceService,
    PracticeSlotsService,
    InstructorScheduleService,
  ],
})
export class LessonsModule {}
