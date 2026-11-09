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
  ApiCreatedResponse,
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
  BOOKING_MIN_LEAD_HOURS,
  CONFIRMATION_DEADLINE_HOURS,
  PRACTICE_BOOKING_DURATION_MIN,
} from './availability';
import {
  CancelLessonDto,
  LessonScheduleConflictResponseDto,
  PracticeLessonDto,
  SCHEDULE_DEFAULT_RANGE_DAYS,
  SCHEDULE_MAX_RANGE_DAYS,
} from './lessons.dto';
import {
  AvailablePracticeSlotListDto,
  AvailablePracticeSlotQueryDto,
  BookPracticeLessonDto,
  PracticeLessonListDto,
  PracticeLessonListQueryDto,
  PracticeLessonOutcomeDto,
  PracticeProgressDto,
  PracticeProgressQueryDto,
  UpdatePracticeCommentDto,
} from './practice-lessons.dto';
import {
  PRACTICE_CONFIRM_ROLES,
  PRACTICE_OUTCOME_ROLES,
  PracticeLessonWorkflowService,
} from './practice-lesson-workflow.service';
import {
  PRACTICE_BOOKING_ROLES,
  PRACTICE_LESSON_LIST_ROLES,
  PRACTICE_PROGRESS_ROLES,
  PracticeLessonsService,
} from './practice-lessons.service';

const RANGE_RULES =
  `За замовчуванням від поточного моменту на ${SCHEDULE_DEFAULT_RANGE_DAYS} днів, ` +
  `не довше ${SCHEDULE_MAX_RANGE_DAYS} днів.`;

const RANGE_BAD_REQUEST =
  'from чи to не ISO 8601 з часовим зсувом (знак + кодуйте як %2B), to не пізніше за from, ' +
  `вікно довше ${SCHEDULE_MAX_RANGE_DAYS} днів`;

const SLOT_RULES =
  `Слот триває ${PRACTICE_BOOKING_DURATION_MIN} хвилин. Слоти нарізаються з робочого графіка інструктора ` +
  `з кроком ${PRACTICE_BOOKING_DURATION_MIN} хвилин від початку кожного інтервалу (09:00–13:00 → 09:00 і 11:00). ` +
  'Слот не перетинає недоступність інструктора і SCHEDULED-заняття інструктора, авто студента чи самого студента ' +
  '(практику й теорію його груп).';

const NO_ACCESS =
  'Роль не STUDENT, або студент не має допуску до практики (PRACTICE): ' +
  '«Немає доступу. Пройдіть курс теорії та отримайте допуск до практики.»';

const PROFILE_CONFLICT =
  'Студент не активний або профіль практики неповний: немає інструктора, авто, категорії чи коробки передач.';

const APPROVAL_RULES =
  `Бронювання студента чекає підтвердження (bookingStatus PENDING) і вже займає час. ` +
  `Без відповіді його автоматично відхиляє система за ${CONFIRMATION_DEADLINE_HOURS} години до початку.`;

const OUTCOME_RULES =
  'Лише для підтвердженого (CONFIRMED) запланованого заняття, що вже почалося. ' +
  'Коментар необов’язковий: якщо переданий, замінює попередній; його бачить і студент.';

const OUTCOME_FORBIDDEN =
  'Роль не ADMIN чи INSTRUCTOR, або інструктор фіксує результат чужого заняття.';

const OUTCOME_CONFLICT =
  'Заняття не підтверджене чи вже не заплановане (тіло з currentStatus — актуальний bookingStatus), ' +
  'або ще не почалося.';

const COMMENT_BAD_REQUEST =
  'id не UUID, зайве поле, або comment порожній, довший за 1000 символів чи містить < або >. ' +
  'Тіло містить errors: [{ field, message }].';

const LESSON_ID_PARAM = {
  name: 'id',
  format: 'uuid',
  description: 'Id практичного заняття.',
} as const;

/**
 * Читання практичних занять, бронювання і його підтвердження. Префікс той
 * самий, що в LessonsController (/lessons/practice): створення, зміна і
 * скасування лишаються там, бо спільні з теорією.
 */
@ApiTags('lessons')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@Controller('lessons/practice')
@UseGuards(AuthGuard, RolesGuard)
export class PracticeLessonsController {
  constructor(
    private readonly practiceLessonsService: PracticeLessonsService,
    private readonly workflowService: PracticeLessonWorkflowService,
  ) {}

  @Get()
  @Roles(...PRACTICE_LESSON_LIST_ROLES)
  @ApiOperation({
    summary: 'Практичні заняття',
    description:
      'Заняття, що перетинають вікно [from, to): ADMIN — усі заняття автошколи, INSTRUCTOR — свої. ' +
      'Фільтри за інструктором, студентом і підтвердженням. ' +
      'confirmationStatus=PENDING — «вхідні» запити, що чекають відповіді інструктора. ' +
      `${RANGE_RULES} Скасовані (зокрема відхилені) — лише з includeCancelled=true.`,
  })
  @ApiOkResponse({ type: PracticeLessonListDto })
  @ApiBadRequestResponse({
    description: `${RANGE_BAD_REQUEST}, instructorId чи studentId не UUID, некоректний includeCancelled чи confirmationStatus або невідомий параметр.`,
  })
  @ApiForbiddenResponse({
    description:
      'Роль не ADMIN чи INSTRUCTOR, або INSTRUCTOR передав чужий instructorId.',
  })
  @ApiNotFoundResponse({
    description: 'Автошколу не знайдено або її видалено.',
  })
  list(
    @CurrentUser() user: User,
    @Query() query: PracticeLessonListQueryDto,
  ): Promise<PracticeLessonListDto> {
    return this.practiceLessonsService.list(user, query);
  }

  @Get('progress')
  @Roles(...PRACTICE_PROGRESS_ROLES)
  @ApiOperation({
    summary: 'Практичний прогрес студента',
    description:
      'Лічильники практики: проведені заняття й хвилини, неявки, скасовані, заплановані та ' +
      'підтверджені, що вже закінчилися без результату. STUDENT бачить свій прогрес (studentId можна не передавати), ' +
      'ADMIN — будь-якого студента своєї автошколи (studentId обов’язковий).',
  })
  @ApiOkResponse({ type: PracticeProgressDto })
  @ApiBadRequestResponse({
    description:
      'studentId не UUID, ADMIN не передав studentId, або невідомий параметр.',
  })
  @ApiForbiddenResponse({
    description:
      'Роль не ADMIN чи STUDENT, або STUDENT передав чужий studentId.',
  })
  @ApiNotFoundResponse({
    description:
      'Автошколу не знайдено, або студента немає в цій автошколі (для ADMIN).',
  })
  progress(
    @CurrentUser() user: User,
    @Query() query: PracticeProgressQueryDto,
  ): Promise<PracticeProgressDto> {
    return this.practiceLessonsService.progress(user, query);
  }

  @Get('available')
  @Roles(...PRACTICE_BOOKING_ROLES)
  @ApiOperation({
    summary: 'Вільні слоти практики для студента',
    description:
      'Вільний час інструктора студента на авто студента: слоти, що починаються у вікні [from, to) ' +
      `і щонайменше за ${BOOKING_MIN_LEAD_HOURS} години від поточного моменту. ` +
      `${RANGE_RULES} ${SLOT_RULES} ` +
      'Інструктор не ACTIVE чи авто не AVAILABLE, не закріплене за ним чи не підходить студенту — порожній список. ' +
      'activeLesson — заплановане заняття студента: поки воно є, нове забронювати не можна.',
  })
  @ApiOkResponse({ type: AvailablePracticeSlotListDto })
  @ApiBadRequestResponse({
    description: `${RANGE_BAD_REQUEST}, або невідомий параметр (наприклад, instructorId).`,
  })
  @ApiForbiddenResponse({ description: NO_ACCESS })
  @ApiNotFoundResponse({
    description: 'Автошколу чи профіль студента не знайдено.',
  })
  @ApiConflictResponse({ description: PROFILE_CONFLICT })
  listAvailable(
    @CurrentUser() user: User,
    @Query() query: AvailablePracticeSlotQueryDto,
  ): Promise<AvailablePracticeSlotListDto> {
    return this.practiceLessonsService.listAvailable(user, query);
  }

  @Post('book')
  @HttpCode(HttpStatus.CREATED)
  @Roles(...PRACTICE_BOOKING_ROLES)
  @ApiOperation({
    summary: 'Забронювати практичне заняття',
    description:
      'Студент бронює один із вільних слотів: створюється заняття з його інструктором і авто. ' +
      `${APPROVAL_RULES} ${SLOT_RULES} ` +
      `Бронювати можна щонайменше за ${BOOKING_MIN_LEAD_HOURS} години до початку. ` +
      'Студент може мати лише одне заплановане заняття, що ще не закінчилося (зокрема таке, що чекає підтвердження). ' +
      'Час перевіряється ще раз під тими самими блокуваннями, що й створення заняття адміном: ' +
      'якщо слот щойно зайняли, повертається 409 — оновіть список вільних слотів.',
  })
  @ApiCreatedResponse({ type: PracticeLessonDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло, зайве поле, scheduledAt без зсуву чи в минулому, порожній чи задовгий meetingPlace. ' +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({ description: NO_ACCESS })
  @ApiNotFoundResponse({
    description:
      'Автошколу, профіль студента, інструктора чи авто не знайдено.',
  })
  @ApiConflictResponse({
    type: LessonScheduleConflictResponseDto,
    description:
      `${PROFILE_CONFLICT} Також: до початку менше ${BOOKING_MIN_LEAD_HOURS} годин; ` +
      'у студента вже є заплановане заняття; інструктор не ACTIVE; ' +
      'авто не AVAILABLE чи не підходить; час поза робочим графіком; ' +
      'або час зайнятий (тіло з conflicts: [{ resource, resourceId, lessonType, lessonId, scheduledAt, endsAt }]).',
  })
  book(
    @CurrentUser() user: User,
    @Body() body: BookPracticeLessonDto,
  ): Promise<PracticeLessonDto> {
    return this.practiceLessonsService.book(user, body);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @Roles(...PRACTICE_CONFIRM_ROLES)
  @ApiOperation({
    summary: 'Підтвердити бронювання практики',
    description:
      'Інструктор заняття або ADMIN підтверджує запит студента: bookingStatus PENDING → CONFIRMED. ' +
      `Підтвердити можна не пізніше ніж за ${CONFIRMATION_DEADLINE_HOURS} години до початку. ` +
      'Інструктор і авто перевіряються ще раз (ACTIVE, AVAILABLE, підходить студенту).',
  })
  @ApiParam(LESSON_ID_PARAM)
  @ApiOkResponse({ type: PracticeLessonDto })
  @ApiBadRequestResponse({ description: 'id не UUID.' })
  @ApiForbiddenResponse({
    description:
      'Роль не ADMIN чи INSTRUCTOR, або інструктор підтверджує чуже заняття.',
  })
  @ApiNotFoundResponse({
    description: 'Заняття не знайдено або воно належить іншій автошколі.',
  })
  @ApiConflictResponse({
    description:
      'Запит уже не чекає підтвердження (тіло з currentStatus — актуальний bookingStatus), ' +
      'прострочений, студент без допуску, інструктор не ACTIVE чи авто непридатне.',
  })
  confirm(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<PracticeLessonDto> {
    return this.workflowService.confirm(user, id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Roles(...PRACTICE_CONFIRM_ROLES)
  @ApiOperation({
    summary: 'Відхилити бронювання практики',
    description:
      'Інструктор заняття або ADMIN відхиляє запит студента: bookingStatus PENDING → REJECTED, ' +
      'заняття скасовується, час знову вільний. Тіло необов’язкове; без reason зберігається ' +
      '«Інструктор відхилив запит».',
  })
  @ApiParam(LESSON_ID_PARAM)
  @ApiOkResponse({ type: PracticeLessonDto })
  @ApiBadRequestResponse({
    description:
      'id не UUID, зайве поле, або reason порожній, довший за 500 символів чи містить < або >.',
  })
  @ApiForbiddenResponse({
    description:
      'Роль не ADMIN чи INSTRUCTOR, або інструктор відхиляє чуже заняття.',
  })
  @ApiNotFoundResponse({
    description: 'Заняття не знайдено або воно належить іншій автошколі.',
  })
  @ApiConflictResponse({
    description:
      'Запит уже не чекає підтвердження (тіло з currentStatus — актуальний bookingStatus).',
  })
  reject(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: CancelLessonDto,
  ): Promise<PracticeLessonDto> {
    return this.workflowService.reject(user, id, body);
  }

  @Post(':id/outcome')
  @HttpCode(HttpStatus.OK)
  @Roles(...PRACTICE_OUTCOME_ROLES)
  @ApiOperation({
    summary: 'Зафіксувати результат практичного заняття',
    description:
      'Інструктор заняття або ADMIN фіксує результат: result COMPLETED — заняття відбулося, ' +
      `NO_SHOW — студент не прийшов (bookingStatus стає таким самим). ${OUTCOME_RULES}`,
  })
  @ApiParam(LESSON_ID_PARAM)
  @ApiOkResponse({ type: PracticeLessonDto })
  @ApiBadRequestResponse({
    description: `result не COMPLETED чи NO_SHOW або відсутній; ${COMMENT_BAD_REQUEST}`,
  })
  @ApiForbiddenResponse({ description: OUTCOME_FORBIDDEN })
  @ApiNotFoundResponse({
    description: 'Заняття не знайдено або воно належить іншій автошколі.',
  })
  @ApiConflictResponse({ description: OUTCOME_CONFLICT })
  recordOutcome(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: PracticeLessonOutcomeDto,
  ): Promise<PracticeLessonDto> {
    return this.workflowService.recordOutcome(user, id, body);
  }

  @Patch(':id/comment')
  @Roles(...PRACTICE_OUTCOME_ROLES)
  @ApiOperation({
    summary: 'Коментар інструктора до практичного заняття',
    description:
      'Інструктор заняття або ADMIN додає чи замінює коментар до заняття, що не скасоване ' +
      '(заплановане, проведене чи з неявкою). Коментар бачить і студент.',
  })
  @ApiParam(LESSON_ID_PARAM)
  @ApiOkResponse({ type: PracticeLessonDto })
  @ApiBadRequestResponse({ description: COMMENT_BAD_REQUEST })
  @ApiForbiddenResponse({
    description:
      'Роль не ADMIN чи INSTRUCTOR, або інструктор коментує чуже заняття.',
  })
  @ApiNotFoundResponse({
    description: 'Заняття не знайдено або воно належить іншій автошколі.',
  })
  @ApiConflictResponse({
    description:
      'Заняття скасоване (тіло з currentStatus — актуальний bookingStatus).',
  })
  updateComment(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdatePracticeCommentDto,
  ): Promise<PracticeLessonDto> {
    return this.workflowService.updateComment(user, id, body);
  }
}
