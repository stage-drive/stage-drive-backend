import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CourseStructureController } from './course-structure.controller';
import { CourseStructureService } from './course-structure.service';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';

@Module({
  imports: [AuthModule],
  controllers: [CoursesController, CourseStructureController],
  providers: [CoursesService, CourseStructureService],
})
export class CoursesModule {}
