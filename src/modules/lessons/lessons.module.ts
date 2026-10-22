import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LessonsController } from './lessons.controller';
import { LessonsService } from './lessons.service';

@Module({
  imports: [AuthModule],
  controllers: [LessonsController],
  providers: [LessonsService],
})
export class LessonsModule {}
