import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
  CreateTimeOffDto,
  ReplaceWorkingHoursDto,
  TIME_OFF_MAX_DAYS,
  TimeOffDto,
  TimeOffListDto,
  TimeOffListQueryDto,
  WorkingHoursDto,
} from './instructor-schedule.dto';
import {
  LESSON_MIN_DURATION_MIN,
  LessonScheduleConflictResponseDto,
  SCHEDULE_DEFAULT_RANGE_DAYS,
  SCHEDULE_MAX_RANGE_DAYS,
} from './lessons.dto';
import {
  InstructorScheduleService,
  SCHEDULE_MANAGE_ROLES,
  SCHEDULE_VIEW_ROLES,
} from './instructor-schedule.service';

const INSTRUCTOR_ID_PARAM = {
  name: 'instructorId',
  format: 'uuid',
  description: 'Id інструктора своєї автошколи.',
} as const;

const TIME_OFF_ID_PARAM = {
  name: 'timeOffId',
  format: 'uuid',
  description: 'Id недоступності.',
} as const;

const VIEW_FORBIDDEN =
  'Роль не ADMIN чи INSTRUCTOR, або INSTRUCTOR відкриває чужий графік.';

const INSTRUCTOR_NOT_FOUND =
  'Автошколу чи інструктора не знайдено, або інструктор належить іншій автошколі.';

@ApiTags('instructor-schedule')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@Controller('instructors/:instructorId')
@UseGuards(AuthGuard, RolesGuard)
export class InstructorScheduleController {
  constructor(private readonly scheduleService: InstructorScheduleService) {}

  @Get('working-hours')
  @Roles(...SCHEDULE_VIEW_ROLES)
  @ApiOperation({
    summary: 'Робочий графік інструктора',
    description:
      'Тижневий графік у часовому поясі автошколи. ADMIN бачить графік будь-якого інструктора, INSTRUCTOR — свій.',
  })
  @ApiParam(INSTRUCTOR_ID_PARAM)
  @ApiOkResponse({ type: WorkingHoursDto })
  @ApiBadRequestResponse({ description: 'instructorId не UUID.' })
  @ApiForbiddenResponse({ description: VIEW_FORBIDDEN })
  @ApiNotFoundResponse({ description: INSTRUCTOR_NOT_FOUND })
  getWorkingHours(
    @CurrentUser() user: User,
    @Param('instructorId', new ParseUUIDPipe({ version: '4' }))
    instructorId: string,
  ): Promise<WorkingHoursDto> {
    return this.scheduleService.getWorkingHours(user, instructorId);
  }

  @Put('working-hours')
  @Roles(...SCHEDULE_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Замінити робочий графік інструктора',
    description:
      'ADMIN задає увесь тиждень одним запитом: попередній графік замінюється цілком. ' +
      'Кілька інтервалів на день — перерви між ними; інтервали одного дня не перетинаються, ' +
      `кожен триває щонайменше ${LESSON_MIN_DURATION_MIN} хвилин. Заброньовані заняття не змінюються.`,
  })
  @ApiParam(INSTRUCTOR_ID_PARAM)
  @ApiOkResponse({ type: WorkingHoursDto })
  @ApiBadRequestResponse({
    description:
      'instructorId не UUID, некоректне тіло, зайве поле, час не HH:MM, end не пізніше за start, ' +
      'інтервал закороткий чи інтервали одного дня перетинаються. Тіло містить errors: [{ field, message }]; ' +
      'field — шлях, наприклад intervals.1.end.',
  })
  @ApiForbiddenResponse({ description: 'Роль не ADMIN.' })
  @ApiNotFoundResponse({ description: INSTRUCTOR_NOT_FOUND })
  @ApiConflictResponse({
    description: 'Користувач не INSTRUCTOR або інструктор не ACTIVE.',
  })
  replaceWorkingHours(
    @CurrentUser() user: User,
    @Param('instructorId', new ParseUUIDPipe({ version: '4' }))
    instructorId: string,
    @Body() body: ReplaceWorkingHoursDto,
  ): Promise<WorkingHoursDto> {
    return this.scheduleService.replaceWorkingHours(user, instructorId, body);
  }

  @Get('time-off')
  @Roles(...SCHEDULE_VIEW_ROLES)
  @ApiOperation({
    summary: 'Недоступність інструктора',
    description:
      'Відпустки, лікарняні й вихідні, що перетинають вікно [from, to): за замовчуванням від поточного моменту ' +
      `на ${SCHEDULE_DEFAULT_RANGE_DAYS} днів, не довше ${SCHEDULE_MAX_RANGE_DAYS} днів. ` +
      'ADMIN бачить будь-якого інструктора, INSTRUCTOR — себе.',
  })
  @ApiParam(INSTRUCTOR_ID_PARAM)
  @ApiOkResponse({ type: TimeOffListDto })
  @ApiBadRequestResponse({
    description:
      'instructorId не UUID, from чи to не ISO 8601 з часовим зсувом, to не пізніше за from, ' +
      `вікно довше ${SCHEDULE_MAX_RANGE_DAYS} днів, або невідомий параметр.`,
  })
  @ApiForbiddenResponse({ description: VIEW_FORBIDDEN })
  @ApiNotFoundResponse({ description: INSTRUCTOR_NOT_FOUND })
  listTimeOff(
    @CurrentUser() user: User,
    @Param('instructorId', new ParseUUIDPipe({ version: '4' }))
    instructorId: string,
    @Query() query: TimeOffListQueryDto,
  ): Promise<TimeOffListDto> {
    return this.scheduleService.listTimeOff(user, instructorId, query);
  }

  @Post('time-off')
  @HttpCode(HttpStatus.CREATED)
  @Roles(...SCHEDULE_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Додати недоступність інструктора',
    description:
      'ADMIN додає відпустку, лікарняний, вихідний чи кілька годин недоступності. ' +
      'Цілі дні — startDate і за потреби endDate (включно, у часовому поясі автошколи); ' +
      'частина дня — startsAt і endsAt. ' +
      `Не довше ${TIME_OFF_MAX_DAYS} днів і не повністю в минулому. ` +
      'Якщо в цей час є SCHEDULED-практика інструктора, повертається 409 зі списком занять: ' +
      'спершу скасуйте чи перенесіть їх.',
  })
  @ApiParam(INSTRUCTOR_ID_PARAM)
  @ApiCreatedResponse({ type: TimeOffDto })
  @ApiBadRequestResponse({
    description:
      'instructorId не UUID, некоректне тіло, зайве поле, обидві форми разом чи жодної, ' +
      'кінець раніше за початок, задовга чи вже закінчена недоступність. Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({ description: 'Роль не ADMIN.' })
  @ApiNotFoundResponse({ description: INSTRUCTOR_NOT_FOUND })
  @ApiConflictResponse({
    type: LessonScheduleConflictResponseDto,
    description:
      'Користувач не INSTRUCTOR, інструктор не ACTIVE, або в цей час є його SCHEDULED-заняття ' +
      '(тіло з conflicts: [{ resource, resourceId, lessonType, lessonId, scheduledAt, endsAt }]).',
  })
  createTimeOff(
    @CurrentUser() user: User,
    @Param('instructorId', new ParseUUIDPipe({ version: '4' }))
    instructorId: string,
    @Body() body: CreateTimeOffDto,
  ): Promise<TimeOffDto> {
    return this.scheduleService.createTimeOff(user, instructorId, body);
  }

  @Delete('time-off/:timeOffId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(...SCHEDULE_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Видалити недоступність інструктора',
    description: 'ADMIN видаляє недоступність. Видалення фізичне.',
  })
  @ApiParam(INSTRUCTOR_ID_PARAM)
  @ApiParam(TIME_OFF_ID_PARAM)
  @ApiNoContentResponse({ description: 'Недоступність видалено.' })
  @ApiBadRequestResponse({ description: 'instructorId чи timeOffId не UUID.' })
  @ApiForbiddenResponse({ description: 'Роль не ADMIN.' })
  @ApiNotFoundResponse({
    description:
      'Недоступність не знайдено, вона належить іншому інструктору чи іншій автошколі.',
  })
  removeTimeOff(
    @CurrentUser() user: User,
    @Param('instructorId', new ParseUUIDPipe({ version: '4' }))
    instructorId: string,
    @Param('timeOffId', new ParseUUIDPipe({ version: '4' })) timeOffId: string,
  ): Promise<void> {
    return this.scheduleService.removeTimeOff(user, instructorId, timeOffId);
  }
}
