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
  LessonAttendanceDto,
  UpdateLessonAttendanceDto,
} from './lesson-attendance.dto';
import { LessonAttendanceService } from './lesson-attendance.service';
import { TheoryLessonContentDto } from './theory-content.dto';
import {
  THEORY_CONTENT_ROLES,
  TheoryContentService,
} from './theory-content.service';
import {
  CancelLessonDto,
  CreatePracticeLessonDto,
  CreateTheoryLessonDto,
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
  PRACTICE_LESSON_CANCEL_ROLES,
  PRACTICE_LESSON_EDIT_ROLES,
  PRACTICE_LESSON_RESCHEDULE_ROLES,
  PRACTICE_LESSON_SCHEDULE_ROLES,
  STUDENT_CANCEL_MIN_HOURS,
  STUDENT_RESCHEDULE_MIN_HOURS,
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
  'Перевіряється: інструктор ACTIVE, не зайнятий і не в недоступності (відпустка, лікарняний), ' +
  'авто AVAILABLE, призначене інструктору, з категорією й коробкою як у студента, і не зайняте, ' +
  'студент у статусі PRACTICE без іншої практики чи теорії своєї групи в цей час. ' +
  'Робочий графік інструктора не перевіряється: так ADMIN додає разову зміну.';

const CREATE_RULES =
  `Тривалість — ціле число хвилин від ${LESSON_MIN_DURATION_MIN} до ${LESSON_MAX_DURATION_MIN}. ` +
  'Заняття створюється зі статусом SCHEDULED і має починатися в майбутньому. ' +
  'Інтервали напіввідкриті: заняття впритул одне до одного не конфліктують. ' +
  'Конфлікт повертає 409 з переліком усіх занять, з якими перетинається час.';

const CREATE_CONFLICT_DESCRIPTION =
  'Група закрита, ресурс недоступний (викладач, студент, інструктор, авто), студенту не призначено ' +
  'інструктора чи авто, або час конфліктує з іншими заняттями ' +
  '(тіло з conflicts: [{ resource, resourceId, lessonType, lessonId, scheduledAt, endsAt }]).';

const LESSON_CONFLICT_DESCRIPTION =
  'Заняття не SCHEDULED (тіло з currentStatus), група закрита, заняття вже почалося, ' +
  'ресурс недоступний (викладач, інструктор, авто, студент), новий час конфліктує з іншими заняттями ' +
  '(тіло з conflicts: [{ resource, resourceId, lessonType, lessonId, scheduledAt, endsAt }]), ' +
  'або теоретичне заняття з відміченим відвідуванням переноситься на інший час.';

const ATTENDANCE_RULES =
  'Список — студенти групи з активним зарахуванням (у закритої групи — її склад на момент закриття) ' +
  'і всі, кого вже відмічено на цьому занятті. Змінювати можна, коли заняття не скасоване, вже почалося, ' +
  'а група відкрита, і лише студентів з активним зарахуванням. ' +
  'Для одного студента зберігається один актуальний статус.';

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
    private readonly lessonAttendanceService: LessonAttendanceService,
    private readonly theoryContentService: TheoryContentService,
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

  @Post('theory')
  @HttpCode(HttpStatus.CREATED)
  @Roles(...THEORY_LESSON_EDIT_ROLES)
  @ApiOperation({
    summary: 'Створити теоретичне заняття',
    description:
      'ADMIN або викладач групи створює заняття групи своєї автошколи. Викладач заняття — викладач групи. ' +
      'courseLessonId, якщо передано, має бути уроком курсу, призначеного цій групі, і не зайнятим іншим нескасованим заняттям групи. ' +
      `${CREATE_RULES} ${THEORY_CHECKS}`,
  })
  @ApiCreatedResponse({ type: TheoryLessonDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло, зайве поле, scheduledAt без зсуву чи в минулому, або день заняття поза датами групи. ' +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description:
      'Роль не ADMIN чи TEACHER, або викладач створює заняття чужої групи.',
  })
  @ApiNotFoundResponse({
    description: 'Групу не знайдено або вона належить іншій автошколі.',
  })
  @ApiConflictResponse({
    type: LessonScheduleConflictResponseDto,
    description: CREATE_CONFLICT_DESCRIPTION,
  })
  createTheory(
    @CurrentUser() user: User,
    @Body() body: CreateTheoryLessonDto,
  ): Promise<TheoryLessonDto> {
    return this.lessonsService.createTheory(user, body);
  }

  @Post('practice')
  @HttpCode(HttpStatus.CREATED)
  @Roles(...PRACTICE_LESSON_SCHEDULE_ROLES)
  @ApiOperation({
    summary: 'Створити практичне заняття',
    description:
      'ADMIN створює заняття будь-якому студенту своєї автошколи. Студенти бронюють самі через POST /lessons/practice/book. ' +
      'Без instructorId і carId беруться інструктор і авто, призначені студенту під час допуску до практики. ' +
      "Місце зустрічі (meetingPlace) обов'язкове. " +
      `${CREATE_RULES} ${PRACTICE_CHECKS}`,
  })
  @ApiCreatedResponse({ type: PracticeLessonDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло, зайве поле, порожній чи задовгий meetingPlace, або scheduledAt без зсуву чи в минулому. ' +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({ description: 'Роль не ADMIN.' })
  @ApiNotFoundResponse({
    description:
      'Студента, інструктора чи авто не знайдено, або вони належать іншій автошколі.',
  })
  @ApiConflictResponse({
    type: LessonScheduleConflictResponseDto,
    description: CREATE_CONFLICT_DESCRIPTION,
  })
  createPractice(
    @CurrentUser() user: User,
    @Body() body: CreatePracticeLessonDto,
  ): Promise<PracticeLessonDto> {
    return this.lessonsService.createPractice(user, body);
  }

  @Patch('theory/:id')
  @Roles(...THEORY_LESSON_EDIT_ROLES)
  @ApiOperation({
    summary: 'Редагувати теоретичне заняття',
    description:
      'ADMIN або викладач групи змінює topic, durationMin і courseLessonId заняття своєї автошколи. ' +
      'courseLessonId: null знімає прив’язку до уроку курсу. Зміна лише topic або courseLessonId не перевіряє розклад. ' +
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
      'ADMIN змінює durationMin, instructorId, carId і meetingPlace; інструктор — лише meetingPlace свого заняття ' +
      '(наприклад, після бронювання студентом без місця зустрічі). ' +
      'Зміна лише meetingPlace не перевіряє розклад. ' +
      'Старе заняття без авто бере авто, призначене студенту, коли змінюється розклад. ' +
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
      'Роль не ADMIN чи INSTRUCTOR, інструктор редагує чуже заняття, або інструктор змінює щось, крім meetingPlace.',
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
  @Roles(...PRACTICE_LESSON_RESCHEDULE_ROLES)
  @ApiOperation({
    summary: 'Перенести практичне заняття',
    description:
      'ADMIN переносить будь-яке заняття на нову дату й час (робочий графік не перевіряється). ' +
      'STUDENT переносить своє бронювання (PENDING чи CONFIRMED) на інший вільний слот однією дією: ' +
      `не пізніше ніж за ${STUDENT_RESCHEDULE_MIN_HOURS} години до поточного початку; новий час — один зі слотів ` +
      'робочого графіка інструктора, щонайменше за 3 години, без конфліктів; durationMin студент не передає. ' +
      'Старий час звільняється, лише якщо новий вдалося зайняти; перенесене бронювання знову чекає ' +
      'підтвердження інструктора (bookingStatus PENDING). Скасоване чи відхилене бронювання не переноситься — ' +
      'забронюйте новий слот. scheduledAt — ISO 8601 з часовим зсувом. ' +
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
      'Роль не ADMIN чи STUDENT, студент переносить чуже заняття або передав durationMin.',
  })
  @ApiNotFoundResponse({
    description: 'Заняття не знайдено або воно належить іншій автошколі.',
  })
  @ApiConflictResponse({
    type: LessonScheduleConflictResponseDto,
    description:
      `${LESSON_CONFLICT_DESCRIPTION} Для студента також: заняття не заплановане (тіло з currentStatus), ` +
      `до його початку менше ${STUDENT_RESCHEDULE_MIN_HOURS} годин, новий час менш ніж за 3 години чи поза слотами графіка.`,
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
  @Roles(...PRACTICE_LESSON_CANCEL_ROLES)
  @ApiOperation({
    summary: 'Скасувати практичне заняття',
    description:
      'ADMIN, інструктор заняття або студент заняття скасовує його. ' +
      'Студент відкликає запит, що чекає підтвердження, будь-коли до початку, ' +
      `а підтверджене заняття скасовує не пізніше ніж за ${STUDENT_CANCEL_MIN_HOURS} години. ` +
      'Інструктор без reason скасовує з причиною «Не можу провести заняття». ' +
      "Тіло необов'язкове. Інструктор, студент і авто лишаються в занятті, а час знову стає вільним для запису. " +
      CANCEL_RULES,
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
      'Роль не ADMIN, INSTRUCTOR чи STUDENT, або інструктор чи студент скасовує чуже заняття.',
  })
  @ApiNotFoundResponse({
    description: 'Заняття не знайдено або воно належить іншій автошколі.',
  })
  @ApiConflictResponse({
    description: `${CANCEL_CONFLICT_DESCRIPTION} Для студента — до початку підтвердженого заняття менше ${STUDENT_CANCEL_MIN_HOURS} годин.`,
  })
  cancelPractice(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: CancelLessonDto,
  ): Promise<PracticeLessonDto> {
    return this.lessonsService.cancelPractice(user, id, body);
  }

  @Get('theory/:id/content')
  @Roles(...THEORY_CONTENT_ROLES)
  @ApiOperation({
    summary: 'Контент курсу, прив’язаний до теоретичного заняття',
    description:
      'ADMIN бачить урок курсу свого заняття, зокрема чернетку. ' +
      'TEACHER — лише заняття своєї групи. ' +
      'STUDENT — лише якщо в нього активне зарахування в групу заняття і курс ACTIVE та PUBLISHED. ' +
      'Заняття без прив’язки або з уроком не з поточного курсу групи — 404. ' +
      'Заняття іншої автошколи — 404.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id теоретичного заняття.',
  })
  @ApiOkResponse({ type: TheoryLessonContentDto })
  @ApiBadRequestResponse({ description: 'id не UUID.' })
  @ApiForbiddenResponse({
    description:
      'Роль не ADMIN, TEACHER чи STUDENT; викладач відкриває чужу групу; ' +
      'студент не зарахований у групу заняття; або курс для студента ще не опубліковано.',
  })
  @ApiNotFoundResponse({
    description:
      'Заняття не знайдено, воно чужої автошколи, не прив’язане до уроку курсу групи, або автошколу видалено.',
  })
  getTheoryContent(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<TheoryLessonContentDto> {
    return this.theoryContentService.getForLesson(user, id);
  }

  @Get('theory/:id/attendance')
  @Roles(...THEORY_LESSON_EDIT_ROLES)
  @ApiOperation({
    summary: 'Відвідування теоретичного заняття',
    description:
      'ADMIN або викладач групи отримує список студентів заняття з поточними статусами. ' +
      `Список видно для заняття в будь-якому стані; editable показує, чи можна його змінити. ${ATTENDANCE_RULES}`,
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id теоретичного заняття.',
  })
  @ApiOkResponse({ type: LessonAttendanceDto })
  @ApiBadRequestResponse({ description: 'id не UUID.' })
  @ApiForbiddenResponse({
    description:
      'Роль не ADMIN чи TEACHER, або викладач відкриває заняття чужої групи.',
  })
  @ApiNotFoundResponse({
    description: 'Заняття не знайдено або воно належить іншій автошколі.',
  })
  getAttendance(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<LessonAttendanceDto> {
    return this.lessonAttendanceService.getAttendance(user, id);
  }

  @Patch('theory/:id/attendance')
  @Roles(...THEORY_LESSON_EDIT_ROLES)
  @ApiOperation({
    summary: 'Відмітити відвідування теоретичного заняття',
    description:
      'ADMIN або викладач групи встановлює статуси переліченим студентам; решта не змінюється. ' +
      `Пакет атомарний. Відповідь — актуальний список після збереження. ${ATTENDANCE_RULES}`,
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id теоретичного заняття.',
  })
  @ApiOkResponse({ type: LessonAttendanceDto })
  @ApiBadRequestResponse({
    description:
      'id не UUID, некоректне тіло, зайве поле, студент повторюється, або студент не входить до складу групи ' +
      '(field: records.<i>.studentId). Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description:
      'Роль не ADMIN чи TEACHER, або викладач змінює відвідування чужої групи.',
  })
  @ApiNotFoundResponse({
    description: 'Заняття не знайдено або воно належить іншій автошколі.',
  })
  @ApiConflictResponse({
    description:
      'Заняття скасоване або в статусі, для якого відвідування не ведеться (тіло з currentStatus), ще не почалося, або група закрита.',
  })
  updateAttendance(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateLessonAttendanceDto,
  ): Promise<LessonAttendanceDto> {
    return this.lessonAttendanceService.updateAttendance(user, id, body);
  }
}
