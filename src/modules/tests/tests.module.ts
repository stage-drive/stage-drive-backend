import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TestsController } from './tests.controller';
import { TestsService } from './tests.service';

@Module({
  imports: [AuthModule],
  controllers: [TestsController],
  providers: [TestsService],
})
export class TestsModule {}
