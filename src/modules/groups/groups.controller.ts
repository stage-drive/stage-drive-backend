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
  CreateGroupDto,
  GroupListDto,
  GroupListItemDto,
  UpdateGroupDto,
  UpdateGroupStatusDto,
} from './groups.dto';
import { GROUP_MANAGE_ROLES, GroupsService } from './groups.service';

@ApiTags('groups')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@Controller('groups')
@UseGuards(AuthGuard, RolesGuard)
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get()
  @Roles(...GROUP_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Список навчальних груп своєї автошколи',
    description:
      'Усі групи організації поточного ADMIN: назва, статус, дати, викладач і кількість активних студентів. ' +
      'Групи інших організацій не повертаються. Якщо груп немає, повертається порожній масив.',
  })
  @ApiOkResponse({ type: GroupListDto })
  @ApiForbiddenResponse({ description: 'Список груп доступний лише ADMIN.' })
  @ApiNotFoundResponse({
    description: 'Автошколу не знайдено або її видалено.',
  })
  list(@CurrentUser() user: User) {
    return this.groupsService.list(user);
  }

  @Post()
  @Roles(...GROUP_MANAGE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Створити навчальну групу своєї автошколи',
    description:
      'ADMIN створює групу у своїй організації. organizationId береться з access token і не приймається в тілі. ' +
      'teacherId має вказувати на активного TEACHER тієї самої автошколи. ' +
      'Назва унікальна серед відкритих груп автошколи без урахування регістру. ' +
      'Дати у форматі YYYY-MM-DD, endDate не раніше startDate. Нова група завжди має статус PLANNED.',
  })
  @ApiCreatedResponse({ type: GroupListItemDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло запиту. Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({ description: 'Створювати групи може лише ADMIN.' })
  @ApiNotFoundResponse({
    description:
      'Автошколу не знайдено або її видалено, або викладач не належить цій автошколі.',
  })
  @ApiConflictResponse({
    description:
      'Відкрита група з такою назвою вже є, користувач не є викладачем, або викладач не ACTIVE.',
  })
  create(@CurrentUser() user: User, @Body() body: CreateGroupDto) {
    return this.groupsService.create(user, body);
  }

  @Patch(':id')
  @Roles(...GROUP_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Редагувати навчальну групу своєї автошколи',
    description:
      'ADMIN змінює name, teacherId, startDate або endDate групи своєї організації. ' +
      'Група іншої автошколи повертає 404. Групу зі статусом COMPLETED або ARCHIVED редагувати не можна. ' +
      'null у startDate чи endDate очищає дату. Статус змінює окремий запит PATCH /groups/{id}/status.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id групи своєї автошколи.',
  })
  @ApiOkResponse({ type: GroupListItemDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло, порожнє тіло або id не UUID. Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({ description: 'Редагувати групи може лише ADMIN.' })
  @ApiNotFoundResponse({
    description:
      'Групу або викладача не знайдено, їх видалено, або вони належать іншій автошколі. ' +
      'Також якщо автошколу видалено.',
  })
  @ApiConflictResponse({
    description:
      'Група закрита (COMPLETED/ARCHIVED), назва зайнята, користувач не є викладачем, або викладач не ACTIVE.',
  })
  update(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateGroupDto,
  ) {
    return this.groupsService.update(user, id, body);
  }

  @Patch(':id/status')
  @Roles(...GROUP_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Змінити статус навчальної групи своєї автошколи',
    description:
      'ADMIN змінює статус групи своєї організації. Група іншої автошколи повертає 404. ' +
      'Переходи: PLANNED → ACTIVE | ARCHIVED; ACTIVE → COMPLETED | ARCHIVED; COMPLETED → ARCHIVED. ' +
      'Повтор того самого статусу, повернення назад і будь-який перехід з ARCHIVED відхиляються. ' +
      'Перехід у COMPLETED або ARCHIVED переводить активні зарахування групи в COMPLETED, ' +
      'тож студентів можна зарахувати в іншу групу. Відповідь містить збережений статус.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id групи своєї автошколи.',
  })
  @ApiOkResponse({ type: GroupListItemDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло або id не UUID. status має бути PLANNED, ACTIVE, COMPLETED або ARCHIVED. ' +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description: 'Змінювати статус групи може лише ADMIN.',
  })
  @ApiNotFoundResponse({
    description:
      'Групу не знайдено або вона належить іншій автошколі. Також якщо автошколу видалено.',
  })
  @ApiConflictResponse({ description: 'Недозволений перехід статусу.' })
  changeStatus(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateGroupStatusDto,
  ) {
    return this.groupsService.changeStatus(user, id, body);
  }
}
