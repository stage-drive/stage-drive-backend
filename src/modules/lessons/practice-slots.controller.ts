import {
  Body,
  Controller,
  Delete,
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
  ApiNoContentResponse,
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
  LESSON_MAX_DURATION_MIN,
  LESSON_MIN_DURATION_MIN,
  LessonScheduleConflictResponseDto,
  SCHEDULE_DEFAULT_RANGE_DAYS,
  SCHEDULE_MAX_RANGE_DAYS,
} from './lessons.dto';
import {
  AvailablePracticeSlotQueryDto,
  CreatePracticeSlotDto,
  PracticeSlotDto,
  PracticeSlotListDto,
  PracticeSlotListQueryDto,
  UpdatePracticeSlotDto,
} from './practice-slots.dto';
import {
  PRACTICE_SLOT_AVAILABLE_ROLES,
  PRACTICE_SLOT_MANAGE_ROLES,
  PRACTICE_SLOT_VIEW_ROLES,
  PracticeSlotsService,
} from './practice-slots.service';

const SLOT_RULES =
  `Тривалість — ціле число хвилин від ${LESSON_MIN_DURATION_MIN} до ${LESSON_MAX_DURATION_MIN}, за замовчуванням 60. ` +
  'Слот починається в майбутньому, на початку хвилини. ' +
  'Інтервали напіввідкриті: слоти й заняття впритул одне до одного не конфліктують.';

const SLOT_CHECKS =
  'Перевіряється: інструктор ACTIVE, авто AVAILABLE і закріплене за інструктором, ' +
  'слот не перетинається з іншими слотами чи SCHEDULED-заняттями цього інструктора чи авто. ' +
  'Робочий графік і недоступність інструктора поки не перевіряються.';

const SLOT_BAD_REQUEST_DESCRIPTION =
  'Некоректне тіло, зайве поле, id не UUID, scheduledAt без зсуву, у минулому чи не на початку хвилини. ' +
  'Тіло містить errors: [{ field, message }].';

const SLOT_CONFLICT_DESCRIPTION =
  'Інструктор не INSTRUCTOR чи не ACTIVE, авто без інструктора, чужого інструктора чи не AVAILABLE, ' +
  'або час перетинається з іншими слотами чи заняттями ' +
  '(тіло з conflicts: [{ resource, resourceId, lessonType, lessonId, scheduledAt, endsAt }]; ' +
  'для lessonType SLOT lessonId — id слоту).';

const SLOT_ID_PARAM = {
  name: 'id',
  format: 'uuid',
  description: 'Id слоту практики.',
} as const;

@ApiTags('practice-slots')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@Controller('practice-slots')
@UseGuards(AuthGuard, RolesGuard)
export class PracticeSlotsController {
  constructor(private readonly practiceSlotsService: PracticeSlotsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(...PRACTICE_SLOT_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Створити слот практики',
    description:
      'ADMIN відкриває для запису час інструктора з авто у своїй автошколі. ' +
      `${SLOT_RULES} ${SLOT_CHECKS}`,
  })
  @ApiCreatedResponse({ type: PracticeSlotDto })
  @ApiBadRequestResponse({ description: SLOT_BAD_REQUEST_DESCRIPTION })
  @ApiForbiddenResponse({ description: 'Роль не ADMIN.' })
  @ApiNotFoundResponse({
    description:
      'Інструктора чи авто не знайдено, або вони належать іншій автошколі.',
  })
  @ApiConflictResponse({
    type: LessonScheduleConflictResponseDto,
    description: SLOT_CONFLICT_DESCRIPTION,
  })
  create(
    @CurrentUser() user: User,
    @Body() body: CreatePracticeSlotDto,
  ): Promise<PracticeSlotDto> {
    return this.practiceSlotsService.create(user, body);
  }

  @Get()
  @Roles(...PRACTICE_SLOT_VIEW_ROLES)
  @ApiOperation({
    summary: 'Список слотів практики',
    description:
      'Слоти, що перетинають вікно [from, to): за замовчуванням від поточного моменту ' +
      `на ${SCHEDULE_DEFAULT_RANGE_DAYS} днів, не довше ${SCHEDULE_MAX_RANGE_DAYS} днів. ` +
      'ADMIN бачить усі слоти автошколи, INSTRUCTOR — лише свої.',
  })
  @ApiOkResponse({ type: PracticeSlotListDto })
  @ApiBadRequestResponse({
    description:
      'from чи to не ISO 8601 з часовим зсувом (знак + кодуйте як %2B), to не пізніше за from, ' +
      `вікно довше ${SCHEDULE_MAX_RANGE_DAYS} днів, instructorId чи carId не UUID, або невідомий параметр. ` +
      'Тіло містить errors: [{ field, message }].',
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
    @Query() query: PracticeSlotListQueryDto,
  ): Promise<PracticeSlotListDto> {
    return this.practiceSlotsService.list(user, query);
  }

  // Оголошено вище за GET :id: Nest реєструє маршрути в порядку оголошення,
  // інакше /available потрапить у findOne і ParseUUIDPipe поверне 400.
  @Get('available')
  @Roles(...PRACTICE_SLOT_AVAILABLE_ROLES)
  @ApiOperation({
    summary: 'Доступні слоти практики для студента',
    description:
      'Слоти інструктора студента, що починаються у вікні [from, to) і в майбутньому: ' +
      `за замовчуванням від поточного моменту на ${SCHEDULE_DEFAULT_RANGE_DAYS} днів, не довше ${SCHEDULE_MAX_RANGE_DAYS} днів. ` +
      'Інструктор ACTIVE, авто AVAILABLE, закріплене за інструктором, з категорією й коробкою студента. ' +
      'Час не зайнятий SCHEDULED-заняттями інструктора, авто чи студента (практика й теорія його груп). ' +
      'Зайняті й недоступні слоти не повертаються. Робочий графік і недоступність інструктора поки не враховуються.',
  })
  @ApiOkResponse({ type: PracticeSlotListDto })
  @ApiBadRequestResponse({
    description:
      'from чи to не ISO 8601 з часовим зсувом (знак + кодуйте як %2B), to не пізніше за from, ' +
      `вікно довше ${SCHEDULE_MAX_RANGE_DAYS} днів, або невідомий параметр (наприклад, instructorId). ` +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({ description: 'Роль не STUDENT.' })
  @ApiNotFoundResponse({
    description: 'Автошколу чи профіль студента не знайдено.',
  })
  @ApiConflictResponse({
    description:
      'Студент не активний чи не має допуску до практики (PRACTICE), ' +
      'або профіль практики неповний: немає інструктора, категорії чи коробки передач.',
  })
  listAvailable(
    @CurrentUser() user: User,
    @Query() query: AvailablePracticeSlotQueryDto,
  ): Promise<PracticeSlotListDto> {
    return this.practiceSlotsService.listAvailable(user, query);
  }

  @Get(':id')
  @Roles(...PRACTICE_SLOT_VIEW_ROLES)
  @ApiOperation({
    summary: 'Слот практики',
    description: 'ADMIN бачить будь-який слот автошколи, INSTRUCTOR — свій.',
  })
  @ApiParam(SLOT_ID_PARAM)
  @ApiOkResponse({ type: PracticeSlotDto })
  @ApiBadRequestResponse({ description: 'id не UUID.' })
  @ApiForbiddenResponse({
    description:
      'Роль не ADMIN чи INSTRUCTOR, або INSTRUCTOR відкриває чужий слот.',
  })
  @ApiNotFoundResponse({
    description: 'Слот не знайдено або він належить іншій автошколі.',
  })
  findOne(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<PracticeSlotDto> {
    return this.practiceSlotsService.findOne(user, id);
  }

  @Patch(':id')
  @Roles(...PRACTICE_SLOT_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Змінити слот практики',
    description:
      'ADMIN змінює інструктора, авто, час чи тривалість слоту, що ще не почався. ' +
      'Нові значення зливаються з поточними й перевіряються як новий слот. ' +
      `${SLOT_RULES} ${SLOT_CHECKS}`,
  })
  @ApiParam(SLOT_ID_PARAM)
  @ApiOkResponse({ type: PracticeSlotDto })
  @ApiBadRequestResponse({
    description: `Порожнє тіло. ${SLOT_BAD_REQUEST_DESCRIPTION}`,
  })
  @ApiForbiddenResponse({ description: 'Роль не ADMIN.' })
  @ApiNotFoundResponse({
    description:
      'Слот, інструктора чи авто не знайдено, або вони належать іншій автошколі.',
  })
  @ApiConflictResponse({
    type: LessonScheduleConflictResponseDto,
    description: `Слот уже почався. ${SLOT_CONFLICT_DESCRIPTION}`,
  })
  update(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdatePracticeSlotDto,
  ): Promise<PracticeSlotDto> {
    return this.practiceSlotsService.update(user, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(...PRACTICE_SLOT_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Видалити слот практики',
    description: 'ADMIN видаляє слот, що ще не почався. Видалення фізичне.',
  })
  @ApiParam(SLOT_ID_PARAM)
  @ApiNoContentResponse({ description: 'Слот видалено.' })
  @ApiBadRequestResponse({ description: 'id не UUID.' })
  @ApiForbiddenResponse({ description: 'Роль не ADMIN.' })
  @ApiNotFoundResponse({
    description: 'Слот не знайдено або він належить іншій автошколі.',
  })
  @ApiConflictResponse({ description: 'Слот уже почався.' })
  remove(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<void> {
    return this.practiceSlotsService.remove(user, id);
  }
}
