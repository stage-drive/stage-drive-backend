import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LessonTestsController } from './lesson-tests.controller';
import { TestAttemptsService } from './test-attempts.service';
import { TestsController } from './tests.controller';
import { TestsService } from './tests.service';

@Module({
  imports: [AuthModule],
  controllers: [TestsController, LessonTestsController],
  providers: [TestsService, TestAttemptsService],
})
export class TestsModule {}
