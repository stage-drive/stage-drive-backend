import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
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
import {
  MyTestAttemptListDto,
  MyTestAttemptsQueryDto,
} from './test-attempts.dto';
import { TestAttemptsService } from './test-attempts.service';
import { LessonTestDto } from './tests.dto';
import { TEST_STUDENT_ROLES, TestsService } from './tests.service';

const uuidPipe = new ParseUUIDPipe({ version: '4' });

@ApiTags('tests')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@Controller('lessons')
@UseGuards(AuthGuard, RolesGuard)
export class LessonTestAccessController {
  constructor(private readonly tests: TestsService) {}

  @Get(':lessonId/test')
  @Roles(...TEST_STUDENT_ROLES)
  @ApiOperation({
    summary: 'Тест уроку для студента',
    description:
      'STUDENT отримує опублікований тест свого уроку: назва, поріг складання, ліміт часу, питання і варіанти без isCorrect. ' +
      'Поряд стан спроб поточного циклу: attemptsUsed, attemptsLeft (з 3), passed, openAttemptId відкритої спроби, ' +
      'nextAttemptAvailable з unavailableReason та lockedNextUntilPassed: наступний урок закритий, доки тест не складено (PASSED). ' +
      'Коли всі 3 спроби витрачено без PASSED, є message «Пройдіть урок ще раз.»: нові 3 спроби з’являються після повторного проходження уроку ' +
      '(POST /courses/{courseId}/lessons/{lessonId}/complete), історія старих спроб лишається. ' +
      'lessonId — id уроку програми курсу (CourseLesson) з GET /courses/{courseId}/content. Переглядати матеріали уроку не обов’язково. ' +
      'Тест доступний лише через ланцюжок студент → група → курс → урок → опублікований тест своєї автошколи. ' +
      'Тест іншої автошколи, чернетка чи архівований тест — 404. Закритий урок, не призначений або не опублікований курс — 403. INSTRUCTOR доступу не має.',
  })
  @ApiParam({
    name: 'lessonId',
    format: 'uuid',
    description: 'Id уроку програми курсу (CourseLesson) своєї автошколи.',
  })
  @ApiOkResponse({ type: LessonTestDto })
  @ApiBadRequestResponse({ description: 'lessonId не UUID.' })
  @ApiForbiddenResponse({
    description:
      'Ендпоінт лише для STUDENT. 403, якщо курс не призначено студенту, не опубліковано чи архівовано, або урок ще закритий попереднім.',
  })
  @ApiNotFoundResponse({
    description:
      'Урок не знайдено, він чужої автошколи, або в уроку немає опублікованого тесту. Також якщо автошколу видалено.',
  })
  getLessonTest(
    @CurrentUser() user: User,
    @Param('lessonId', uuidPipe) lessonId: string,
  ) {
    return this.tests.getLessonTest(user, lessonId);
  }
}

@ApiTags('tests')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@Controller('me/test-attempts')
@UseGuards(AuthGuard, RolesGuard)
export class MyTestAttemptsController {
  constructor(private readonly attempts: TestAttemptsService) {}

  @Get()
  @Roles(...TEST_STUDENT_ROLES)
  @ApiOperation({
    summary: 'Усі мої спроби тестів',
    description:
      'STUDENT бачить свої спроби по всіх тестах своєї автошколи, від новішої, зі сторінками page і limit. ' +
      'Фільтри: testId, lessonId (урок програми курсу), status (IN_PROGRESS, COMPLETED, EXPIRED), result (PASSED, FAILED). ' +
      'Кожен рядок: тест, номер спроби в циклі, статус, результат, scorePercent, correctCount, totalQuestions і час. ' +
      'Питання і правильні відповіді не входять: їх відкриває GET /tests/attempts/{attemptId} для перевіреної спроби. ' +
      'Прострочені відкриті спроби перед читанням закриваються як EXPIRED.',
  })
  @ApiOkResponse({ type: MyTestAttemptListDto })
  @ApiBadRequestResponse({
    description:
      'Фільтр не UUID або не з дозволених значень, page чи limit поза межами. Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({ description: 'Ендпоінт лише для STUDENT.' })
  @ApiNotFoundResponse({
    description: 'Автошколу не знайдено або її видалено.',
  })
  list(@CurrentUser() user: User, @Query() query: MyTestAttemptsQueryDto) {
    return this.attempts.listMyAttempts(user, query);
  }
}
