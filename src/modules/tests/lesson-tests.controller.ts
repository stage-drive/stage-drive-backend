import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { User } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { COURSE_CONTENT_ROLES } from '../courses/courses.service';
import { CreateLessonTestDto, TestDto } from './tests.dto';
import { TestsService } from './tests.service';

const uuidPipe = new ParseUUIDPipe({ version: '4' });

@ApiTags('courses')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@Controller('courses')
@UseGuards(AuthGuard, RolesGuard)
export class LessonTestsController {
  constructor(private readonly tests: TestsService) {}

  @Post(':courseId/chapters/:chapterId/lessons/:lessonId/test')
  @Roles(...COURSE_CONTENT_ROLES)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Створити тест уроку теоретичного курсу',
    description:
      'ADMIN або TEACHER групи з цим курсом створює тест, прив’язаний до уроку з адреси. organizationId і courseId з тіла не беруться. ' +
      'maxAttempts завжди 3 і окремо не передається. Новий тест — DRAFT, доки його не опублікують ' +
      'через PATCH /tests/{testId}/publication. Другий не архівний тест того самого уроку — 409. ' +
      'Це те саме, що POST /tests із lessonId. Студент має 3 спроби на цикл: коли всі витрачено без PASSED, ' +
      'він бачить «Пройдіть урок ще раз.» і після повторного проходження уроку отримує ще 3 спроби. ' +
      'Наступний урок не віддає матеріали, доки цей тест не складено.',
  })
  @ApiParam({ name: 'courseId', format: 'uuid' })
  @ApiParam({ name: 'chapterId', format: 'uuid' })
  @ApiParam({ name: 'lessonId', format: 'uuid' })
  @ApiCreatedResponse({ type: TestDto })
  @ApiBadRequestResponse({
    description: 'Некоректне тіло. Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description:
      'Створювати тест уроку може ADMIN або TEACHER групи, якій призначено цей курс.',
  })
  @ApiNotFoundResponse({
    description: 'Курс, розділ або урок не знайдено в цій автошколі.',
  })
  @ApiConflictResponse({
    description: 'У цього уроку вже є тест, або назва тесту вже зайнята.',
  })
  create(
    @CurrentUser() user: User,
    @Param('courseId', uuidPipe) courseId: string,
    @Param('chapterId', uuidPipe) chapterId: string,
    @Param('lessonId', uuidPipe) lessonId: string,
    @Body() body: CreateLessonTestDto,
  ) {
    return this.tests.createForLesson(
      user,
      courseId,
      chapterId,
      lessonId,
      body,
    );
  }
}
