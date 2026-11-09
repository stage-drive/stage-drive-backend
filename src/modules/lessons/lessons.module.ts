import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InstructorScheduleController } from './instructor-schedule.controller';
import { InstructorScheduleService } from './instructor-schedule.service';
import { LessonAttendanceService } from './lesson-attendance.service';
import { LessonsController } from './lessons.controller';
import { LessonsService } from './lessons.service';
import { PersonalScheduleService } from './personal-schedule.service';
import { PracticeLessonWorkflowService } from './practice-lesson-workflow.service';
import { PracticeLessonsController } from './practice-lessons.controller';
import { PracticeLessonsService } from './practice-lessons.service';
import { PracticePaymentService } from './practice-payment.service';
import { PracticeRequestExpiryJob } from './practice-request-expiry.job';

@Module({
  imports: [AuthModule],
  controllers: [
    LessonsController,
    PracticeLessonsController,
    InstructorScheduleController,
  ],
  providers: [
    LessonsService,
    PersonalScheduleService,
    LessonAttendanceService,
    InstructorScheduleService,
    PracticeLessonsService,
    PracticeLessonWorkflowService,
    PracticePaymentService,
    PracticeRequestExpiryJob,
  ],
})
export class LessonsModule {}
