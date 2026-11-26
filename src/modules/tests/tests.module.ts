import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LessonTestsController } from './lesson-tests.controller';
import {
  LessonTestAccessController,
  MyTestAttemptsController,
} from './student-tests.controller';
import { TestAttemptsService } from './test-attempts.service';
import { TestsController } from './tests.controller';
import { TestsService } from './tests.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [
    TestsController,
    LessonTestsController,
    LessonTestAccessController,
    MyTestAttemptsController,
  ],
  providers: [TestsService, TestAttemptsService],
})
export class TestsModule {}
