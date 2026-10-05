import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CarsController } from './cars.controller';
import { CarsService } from './cars.service';

@Module({
  imports: [AuthModule],
  controllers: [CarsController],
  providers: [CarsService],
})
export class CarsModule {}
