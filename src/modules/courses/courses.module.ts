import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CourseProgressController } from './course-progress.controller';
import { CourseProgressService } from './course-progress.service';
import { CourseStructureController } from './course-structure.controller';
import { CourseStructureService } from './course-structure.service';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';

@Module({
  imports: [AuthModule],
  controllers: [
    CoursesController,
    CourseStructureController,
    CourseProgressController,
  ],
  providers: [CoursesService, CourseStructureService, CourseProgressService],
})
export class CoursesModule {}
