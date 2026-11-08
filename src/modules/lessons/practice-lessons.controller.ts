import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { User } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PRACTICE_BOOKING_DURATION_MIN } from './availability';
import {
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
} from './practice-lessons.dto';
import {
  PRACTICE_BOOKING_ROLES,
  PRACTICE_LESSON_LIST_ROLES,
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

const PROFILE_CONFLICT =
  'Студент не активний чи не має допуску до практики (PRACTICE), ' +
  'або профіль практики неповний: немає інструктора, авто, категорії чи коробки передач.';

/**
 * Читання практичних занять і бронювання. Префікс той самий, що в
 * LessonsController (/lessons/practice): створення, зміна і скасування
 * лишаються там, бо спільні з теорією.
 */
@ApiTags('lessons')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@Controller('lessons/practice')
@UseGuards(AuthGuard, RolesGuard)
export class PracticeLessonsController {
  constructor(
    private readonly practiceLessonsService: PracticeLessonsService,
  ) {}

  @Get()
  @Roles(...PRACTICE_LESSON_LIST_ROLES)
  @ApiOperation({
    summary: 'Практичні заняття автошколи',
    description:
      'ADMIN бачить заняття, що перетинають вікно [from, to), з фільтрами за інструктором і студентом. ' +
      `${RANGE_RULES} Скасовані — лише з includeCancelled=true.`,
  })
  @ApiOkResponse({ type: PracticeLessonListDto })
  @ApiBadRequestResponse({
    description: `${RANGE_BAD_REQUEST}, instructorId чи studentId не UUID, некоректний includeCancelled або невідомий параметр.`,
  })
  @ApiForbiddenResponse({ description: 'Роль не ADMIN.' })
  @ApiNotFoundResponse({
    description: 'Автошколу не знайдено або її видалено.',
  })
  list(
    @CurrentUser() user: User,
    @Query() query: PracticeLessonListQueryDto,
  ): Promise<PracticeLessonListDto> {
    return this.practiceLessonsService.list(user, query);
  }

  @Get('available')
  @Roles(...PRACTICE_BOOKING_ROLES)
  @ApiOperation({
    summary: 'Вільні слоти практики для студента',
    description:
      'Вільний час інструктора студента на авто студента: слоти, що починаються у вікні [from, to) і в майбутньому. ' +
      `${RANGE_RULES} ${SLOT_RULES} ` +
      'Інструктор не ACTIVE чи авто не AVAILABLE, не закріплене за ним чи не підходить студенту — порожній список. ' +
      'activeLesson — заплановане заняття студента: поки воно є, нове забронювати не можна.',
  })
  @ApiOkResponse({ type: AvailablePracticeSlotListDto })
  @ApiBadRequestResponse({
    description: `${RANGE_BAD_REQUEST}, або невідомий параметр (наприклад, instructorId).`,
  })
  @ApiForbiddenResponse({ description: 'Роль не STUDENT.' })
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
      'Студент бронює один із вільних слотів: створюється SCHEDULED-заняття з його інструктором і авто. ' +
      `${SLOT_RULES} ` +
      'Студент може мати лише одне заплановане заняття, що ще не закінчилося. ' +
      'Час перевіряється ще раз під тими самими блокуваннями, що й створення заняття адміном: ' +
      'якщо слот щойно зайняли, повертається 409 — оновіть список вільних слотів.',
  })
  @ApiCreatedResponse({ type: PracticeLessonDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло, зайве поле, scheduledAt без зсуву чи в минулому, порожній чи задовгий meetingPlace. ' +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({ description: 'Роль не STUDENT.' })
  @ApiNotFoundResponse({
    description:
      'Автошколу, профіль студента, інструктора чи авто не знайдено.',
  })
  @ApiConflictResponse({
    type: LessonScheduleConflictResponseDto,
    description:
      `${PROFILE_CONFLICT} Також: у студента вже є заплановане заняття; інструктор не ACTIVE; ` +
      'авто не AVAILABLE чи не підходить; час поза робочим графіком; ' +
      'або час зайнятий (тіло з conflicts: [{ resource, resourceId, lessonType, lessonId, scheduledAt, endsAt }]).',
  })
  book(
    @CurrentUser() user: User,
    @Body() body: BookPracticeLessonDto,
  ): Promise<PracticeLessonDto> {
    return this.practiceLessonsService.book(user, body);
  }
}
