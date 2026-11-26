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
  NotificationDto,
  NotificationListDto,
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
    summary: 'Сповіщення поточного користувача',
    description:
      'Лише сповіщення отримувача в його автошколі, від нових до старих. ' +
      'readStatus фільтрує UNREAD або READ. Чужі сповіщення і сповіщення іншої автошколи не повертаються. ' +
      'organizationId береться з access token.',
  })
  @ApiOkResponse({ type: NotificationListDto })
  @ApiNotFoundResponse({
    description: 'Автошколу не знайдено або її видалено.',
  })
  list(@CurrentUser() user: User, @Query() query: ListNotificationsQueryDto) {
    return this.notifications.list(user, query);
  }

  @Get('unread-count')
  @ApiOperation({
    summary: 'Кількість непрочитаних сповіщень',
    description:
      'Лічильник UNREAD поточного користувача в його автошколі. Якщо сповіщень немає, count дорівнює 0.',
  })
  @ApiOkResponse({ type: UnreadNotificationCountDto })
  @ApiNotFoundResponse({
    description: 'Автошколу не знайдено або її видалено.',
  })
  unreadCount(@CurrentUser() user: User) {
    return this.notifications.unreadCount(user);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Позначити сповіщення прочитаним',
    description:
      'Ставить readStatus = READ і readAt. Повторний виклик повертає те саме сповіщення без нової дати. ' +
      'Чуже сповіщення або сповіщення іншої автошколи — 404.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: NotificationDto })
  @ApiNotFoundResponse({
    description: 'Сповіщення не знайдено або автошколу видалено.',
  })
  markRead(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(user, id);
  }
}
