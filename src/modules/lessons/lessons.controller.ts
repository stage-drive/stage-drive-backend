import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
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
  CancelLessonDto,
  LESSON_MAX_DURATION_MIN,
  LESSON_MIN_DURATION_MIN,
  LessonScheduleConflictResponseDto,
  PersonalScheduleDto,
  PersonalScheduleQueryDto,
  PracticeLessonDto,
  RescheduleLessonDto,
  SCHEDULE_DEFAULT_RANGE_DAYS,
  SCHEDULE_MAX_RANGE_DAYS,
  TheoryLessonDto,
  UpdatePracticeLessonDto,
  UpdateTheoryLessonDto,
} from './lessons.dto';
import {
  LessonsService,
  PRACTICE_LESSON_EDIT_ROLES,
  THEORY_LESSON_EDIT_ROLES,
} from './lessons.service';
import {
  PersonalScheduleService,
  SCHEDULE_VIEW_ROLES,
} from './personal-schedule.service';

const PERSONAL_SCHEDULE_DESCRIPTION =
  'Розклад поточного користувача. TEACHER — теорія своїх груп; INSTRUCTOR — свої практичні заняття; ' +
  'STUDENT — теорія своєї групи і своя практика, а з завершених груп лише заняття, що вже почалися. ' +
  'Повертаються заняття, що перетинають вікно [from, to): за замовчуванням від поточного моменту ' +
  `на ${SCHEDULE_DEFAULT_RANGE_DAYS} днів, не довше ${SCHEDULE_MAX_RANGE_DAYS} днів. ` +
  'Скасовані — лише з includeCancelled=true. timing показує, чи заняття майбутнє, триває або закінчилося. ' +
  'Заняття інших автошкіл і людей не повертаються.';

const PERSONAL_SCHEDULE_BAD_REQUEST_DESCRIPTION =
  'from чи to не ISO 8601 з часовим зсувом (знак + кодуйте як %2B), to не пізніше за from, ' +
  `вікно довше ${SCHEDULE_MAX_RANGE_DAYS} днів, некоректний type чи includeCancelled, ` +
  'або невідомий параметр (зокрема userId, groupId, organizationId). Тіло містить errors: [{ field, message }].';

const SCHEDULE_RULES =
  `Тривалість — ціле число хвилин від ${LESSON_MIN_DURATION_MIN} до ${LESSON_MAX_DURATION_MIN}. ` +
  'Змінити можна лише заняття зі статусом SCHEDULED; новий розклад має починатися в майбутньому. ' +
  'Інтервали напіввідкриті: заняття впритул одне до одного не конфліктують. ' +
  'Конфлікт повертає 409 з переліком усіх занять, з якими перетинається новий час.';

const THEORY_CHECKS =
  'Перевіряється: група відкрита (PLANNED/ACTIVE), день заняття в межах дат групи за часовим поясом автошколи, ' +
  'викладач групи ACTIVE і не зайнятий іншою теорією, група не має іншої теорії, ' +
  'студенти групи не мають практики в цей час.';

const PRACTICE_CHECKS =
  'Перевіряється: інструктор ACTIVE і не зайнятий, авто AVAILABLE, призначене інструктору, ' +
  'з категорією й коробкою як у студента, і не зайняте, студент у статусі PRACTICE без іншої практики ' +
  'чи теорії своєї групи в цей час.';

const LESSON_CONFLICT_DESCRIPTION =
  'Заняття не SCHEDULED (тіло з currentStatus), група закрита, заняття вже почалося, ' +
  'ресурс недоступний (викладач, інструктор, авто, студент), або новий час конфліктує з іншими заняттями ' +
  '(тіло з conflicts: [{ resource, resourceId, lessonType, lessonId, scheduledAt, endsAt }]).';

const CANCEL_RULES =
  'Скасувати можна лише заняття зі статусом SCHEDULED, яке ще не почалося. ' +
  'Заняття не видаляється: статус стає CANCELLED, зберігаються час, автор і причина скасування. ' +
  'Скасоване заняття не займає час у розкладі й зникає з дашбордів. ' +
  'Стан ресурсів (викладач, інструктор, авто, студент) не перевіряється.';

const CANCEL_CONFLICT_DESCRIPTION =
  'Заняття не SCHEDULED (тіло з currentStatus, зокрема повторне скасування), ' +
  'заняття вже почалося, або група теоретичного заняття закрита.';

const CANCEL_BAD_REQUEST_DESCRIPTION =
  'id не UUID, зайве поле в тілі, або reason порожній, довший за 500 символів, містить < чи >, або null. ' +
  'Тіло містить errors: [{ field, message }].';

@ApiTags('lessons')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@Controller('lessons')
@UseGuards(AuthGuard, RolesGuard)
export class LessonsController {
  constructor(
    private readonly lessonsService: LessonsService,
    private readonly personalScheduleService: PersonalScheduleService,
  ) {}

  @Get('me')
  @Roles(...SCHEDULE_VIEW_ROLES)
  @ApiOperation({
    summary: 'Персональний розклад',
    description: PERSONAL_SCHEDULE_DESCRIPTION,
  })
  @ApiOkResponse({ type: PersonalScheduleDto })
  @ApiBadRequestResponse({
    description: PERSONAL_SCHEDULE_BAD_REQUEST_DESCRIPTION,
  })
  @ApiForbiddenResponse({
    description:
      'Роль не TEACHER, INSTRUCTOR чи STUDENT: у OWNER і ADMIN немає власного розкладу.',
  })
  @ApiNotFoundResponse({
    description: 'Автошколу не знайдено або її видалено.',
  })
  getMySchedule(
    @CurrentUser() user: User,
    @Query() query: PersonalScheduleQueryDto,
  ): Promise<PersonalScheduleDto> {
    return this.personalScheduleService.getMySchedule(user, query);
  }

  @Patch('theory/:id')
  @Roles(...THEORY_LESSON_EDIT_ROLES)
  @ApiOperation({
    summary: 'Редагувати теоретичне заняття',
    description:
      'ADMIN або викладач групи змінює topic і durationMin заняття своєї автошколи. ' +
      'Зміна лише topic не перевіряє розклад. ' +
      `${SCHEDULE_RULES} ${THEORY_CHECKS}`,
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id теоретичного заняття.',
  })
  @ApiOkResponse({ type: TheoryLessonDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне або порожнє тіло, id не UUID, або день заняття поза датами групи. ' +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description:
      'Роль не ADMIN чи TEACHER, або викладач редагує заняття чужої групи.',
  })
  @ApiNotFoundResponse({
    description: 'Заняття не знайдено або воно належить іншій автошколі.',
  })
  @ApiConflictResponse({
    type: LessonScheduleConflictResponseDto,
    description: LESSON_CONFLICT_DESCRIPTION,
  })
  updateTheory(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateTheoryLessonDto,
  ): Promise<TheoryLessonDto> {
    return this.lessonsService.updateTheory(user, id, body);
  }

  @Patch('theory/:id/reschedule')
  @Roles(...THEORY_LESSON_EDIT_ROLES)
  @ApiOperation({
    summary: 'Перенести теоретичне заняття',
    description:
      'ADMIN або викладач групи переносить заняття на нову дату й час. ' +
      'scheduledAt — ISO 8601 з часовим зсувом. ' +
      `${SCHEDULE_RULES} ${THEORY_CHECKS}`,
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id теоретичного заняття.',
  })
  @ApiOkResponse({ type: TheoryLessonDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло, scheduledAt без зсуву чи в минулому, id не UUID, або день заняття поза датами групи. ' +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description:
      'Роль не ADMIN чи TEACHER, або викладач переносить заняття чужої групи.',
  })
  @ApiNotFoundResponse({
    description: 'Заняття не знайдено або воно належить іншій автошколі.',
  })
  @ApiConflictResponse({
    type: LessonScheduleConflictResponseDto,
    description: LESSON_CONFLICT_DESCRIPTION,
  })
  rescheduleTheory(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: RescheduleLessonDto,
  ): Promise<TheoryLessonDto> {
    return this.lessonsService.rescheduleTheory(user, id, body);
  }

  @Patch('practice/:id')
  @Roles(...PRACTICE_LESSON_EDIT_ROLES)
  @ApiOperation({
    summary: 'Редагувати практичне заняття',
    description:
      'ADMIN змінює durationMin, instructorId і carId; інструктор — лише durationMin і carId свого заняття. ' +
      'Старе заняття без авто бере авто, призначене студенту. ' +
      `${SCHEDULE_RULES} ${PRACTICE_CHECKS}`,
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id практичного заняття.',
  })
  @ApiOkResponse({ type: PracticeLessonDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне або порожнє тіло, або id не UUID. Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description:
      'Роль не ADMIN чи INSTRUCTOR, інструктор редагує чуже заняття, або інструктор змінює instructorId.',
  })
  @ApiNotFoundResponse({
    description:
      'Заняття, інструктора чи авто не знайдено, або вони належать іншій автошколі.',
  })
  @ApiConflictResponse({
    type: LessonScheduleConflictResponseDto,
    description: LESSON_CONFLICT_DESCRIPTION,
  })
  updatePractice(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdatePracticeLessonDto,
  ): Promise<PracticeLessonDto> {
    return this.lessonsService.updatePractice(user, id, body);
  }

  @Patch('practice/:id/reschedule')
  @Roles(...PRACTICE_LESSON_EDIT_ROLES)
  @ApiOperation({
    summary: 'Перенести практичне заняття',
    description:
      'ADMIN або інструктор заняття переносить його на нову дату й час. ' +
      'scheduledAt — ISO 8601 з часовим зсувом. ' +
      `${SCHEDULE_RULES} ${PRACTICE_CHECKS}`,
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id практичного заняття.',
  })
  @ApiOkResponse({ type: PracticeLessonDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло, scheduledAt без зсуву чи в минулому, або id не UUID. ' +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description:
      'Роль не ADMIN чи INSTRUCTOR, або інструктор переносить чуже заняття.',
  })
  @ApiNotFoundResponse({
    description: 'Заняття не знайдено або воно належить іншій автошколі.',
  })
  @ApiConflictResponse({
    type: LessonScheduleConflictResponseDto,
    description: LESSON_CONFLICT_DESCRIPTION,
  })
  reschedulePractice(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: RescheduleLessonDto,
  ): Promise<PracticeLessonDto> {
    return this.lessonsService.reschedulePractice(user, id, body);
  }

  @Post('theory/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(...THEORY_LESSON_EDIT_ROLES)
  @ApiOperation({
    summary: 'Скасувати теоретичне заняття',
    description: `ADMIN або викладач групи скасовує заняття своєї автошколи. Тіло необов'язкове. ${CANCEL_RULES}`,
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id теоретичного заняття.',
  })
  @ApiOkResponse({ type: TheoryLessonDto })
  @ApiBadRequestResponse({ description: CANCEL_BAD_REQUEST_DESCRIPTION })
  @ApiForbiddenResponse({
    description:
      'Роль не ADMIN чи TEACHER, або викладач скасовує заняття чужої групи.',
  })
  @ApiNotFoundResponse({
    description: 'Заняття не знайдено або воно належить іншій автошколі.',
  })
  @ApiConflictResponse({ description: CANCEL_CONFLICT_DESCRIPTION })
  cancelTheory(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: CancelLessonDto,
  ): Promise<TheoryLessonDto> {
    return this.lessonsService.cancelTheory(user, id, body);
  }

  @Post('practice/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(...PRACTICE_LESSON_EDIT_ROLES)
  @ApiOperation({
    summary: 'Скасувати практичне заняття',
    description: `ADMIN або інструктор заняття скасовує його. Тіло необов'язкове. Інструктор, студент і авто лишаються в занятті. ${CANCEL_RULES}`,
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id практичного заняття.',
  })
  @ApiOkResponse({ type: PracticeLessonDto })
  @ApiBadRequestResponse({ description: CANCEL_BAD_REQUEST_DESCRIPTION })
  @ApiForbiddenResponse({
    description:
      'Роль не ADMIN чи INSTRUCTOR, або інструктор скасовує чуже заняття.',
  })
  @ApiNotFoundResponse({
    description: 'Заняття не знайдено або воно належить іншій автошколі.',
  })
  @ApiConflictResponse({ description: CANCEL_CONFLICT_DESCRIPTION })
  cancelPractice(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: CancelLessonDto,
  ): Promise<PracticeLessonDto> {
    return this.lessonsService.cancelPractice(user, id, body);
  }
}
