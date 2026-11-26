import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { User, UserRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  ListNotificationsQueryDto,
  MarkAllNotificationsReadDto,
  NotificationEntityDto,
  NotificationListDto,
  NotificationStatusDto,
  UnreadNotificationCountDto,
} from './notifications.dto';
import { NotificationsService } from './notifications.service';

const READ_ROLES = [
  UserRole.OWNER,
  UserRole.ADMIN,
  UserRole.TEACHER,
  UserRole.INSTRUCTOR,
  UserRole.STUDENT,
] as const;

@ApiTags('notifications')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@ApiForbiddenResponse({
  description: 'Користувач не належить до автошколи або не має ролі.',
})
@Controller('notifications')
@UseGuards(AuthGuard, RolesGuard)
@Roles(...READ_ROLES)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Dropdown і Notification Center',
    description:
      'Лише сповіщення отримувача в його автошколі, від нових до старих. ' +
      'Dropdown дзвіночка: limit без readStatus (наприклад 10). ' +
      'Notification Center: page, limit і за потреби readStatus UNREAD або READ. ' +
      'unreadCount — індикатор на цей момент, він не залежить від фільтра і сторінки. ' +
      'Порожній стан: items = [] і unreadCount = 0, це не помилка. ' +
      'Чужі сповіщення і сповіщення іншої автошколи не повертаються. ' +
      'organizationId береться з access token.',
  })
  @ApiOkResponse({ type: NotificationListDto })
  @ApiBadRequestResponse({
    description:
      'Некоректні query-параметри. Тіло містить errors: [{ field, message }].',
  })
  @ApiNotFoundResponse({
    description: 'Автошколу не знайдено або її видалено.',
  })
  list(@CurrentUser() user: User, @Query() query: ListNotificationsQueryDto) {
    return this.notifications.list(user, query);
  }

  @Get('unread-count')
  @ApiOperation({
    summary: 'Індикатор непрочитаних сповіщень',
    description:
      'Лічильник UNREAD поточного користувача в його автошколі. Якщо сповіщень немає, count дорівнює 0. ' +
      'Той самий лічильник є в списку як unreadCount.',
  })
  @ApiOkResponse({ type: UnreadNotificationCountDto })
  @ApiNotFoundResponse({
    description: 'Автошколу не знайдено або її видалено.',
  })
  unreadCount(@CurrentUser() user: User) {
    return this.notifications.unreadCount(user);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Позначити всі свої сповіщення прочитаними',
    description:
      'Ставить readStatus = READ і однаковий readAt усім UNREAD поточного користувача в його автошколі. ' +
      'Чужі сповіщення не змінюються. Якщо непрочитаних немає, updated = 0. ' +
      'unreadCount — лічильник після зміни.',
  })
  @ApiOkResponse({ type: MarkAllNotificationsReadDto })
  @ApiNotFoundResponse({
    description: 'Автошколу не знайдено або її видалено.',
  })
  markAllRead(@CurrentUser() user: User) {
    return this.notifications.markAllRead(user);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Позначити сповіщення прочитаним',
    description:
      'Ставить readStatus = READ і readAt. Повторний виклик повертає те саме сповіщення без нової дати. ' +
      'unreadCount у відповіді — лічильник після зміни, тож індикатор оновлюється цим самим запитом. ' +
      'Чуже сповіщення або сповіщення іншої автошколи — 404.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: NotificationStatusDto })
  @ApiBadRequestResponse({ description: 'id не є UUID.' })
  @ApiNotFoundResponse({
    description: 'Сповіщення не знайдено або автошколу видалено.',
  })
  markRead(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(user, id);
  }

  @Patch(':id/unread')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Позначити сповіщення непрочитаним',
    description:
      'Ставить readStatus = UNREAD і прибирає readAt. Повторний виклик нічого не змінює. ' +
      'unreadCount у відповіді — лічильник після зміни. ' +
      'Чуже сповіщення або сповіщення іншої автошколи — 404.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: NotificationStatusDto })
  @ApiBadRequestResponse({ description: 'id не є UUID.' })
  @ApiNotFoundResponse({
    description: 'Сповіщення не знайдено або автошколу видалено.',
  })
  markUnread(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.markUnread(user, id);
  }

  @Get(':id/target')
  @ApiOperation({
    summary: 'Пов’язана сутність сповіщення',
    description:
      'Повертає тип і ідентифікатор сутності, до якої веде своє сповіщення, після перевірки доступу. ' +
      'THEORY_LESSON: ADMIN — будь-яке заняття автошколи, TEACHER — заняття своєї групи, STUDENT — заняття групи з активним зарахуванням (історія завершеного зарахування — лише для занять, що вже почалися). ' +
      'PRACTICE_LESSON: ADMIN — будь-яке, INSTRUCTOR — своє, STUDENT — своє. ' +
      'TEST: ADMIN — будь-який, TEACHER — тест курсу своєї групи, STUDENT — опублікований тест опублікованого активного курсу зі своїм активним зарахуванням. ' +
      'TEST_ATTEMPT: лише STUDENT і лише своя спроба. ' +
      'PAYMENT: OWNER і ADMIN — будь-яка оплата автошколи, STUDENT — лише своя. ' +
      'Сутність іншої автошколи для цього запиту не існує.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: NotificationEntityDto })
  @ApiBadRequestResponse({ description: 'id не є UUID.' })
  @ApiForbiddenResponse({
    description: 'Сутність існує, але роль або належність не дає її відкрити.',
  })
  @ApiNotFoundResponse({
    description:
      'Сповіщення не знайдено, у нього немає пов’язаної сутності, або сутність видалено.',
  })
  target(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.target(user, id);
  }
}
