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
  AddGroupStudentDto,
  AssignGroupCourseDto,
  CreateGroupDto,
  GroupListDto,
  GroupListItemDto,
  GroupStudentsDto,
  UpdateGroupDto,
  UpdateGroupStatusDto,
} from './groups.dto';
import {
  GROUP_MANAGE_ROLES,
  GROUP_ROSTER_ROLES,
  GroupsService,
} from './groups.service';

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

  @Patch(':id/course')
  @Roles(...GROUP_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Призначити, змінити або зняти теоретичний курс групи',
    description:
      'ADMIN призначає групі своєї автошколи курс тієї самої автошколи зі статусом ACTIVE. ' +
      'null знімає курс. Група іншої автошколи повертає 404, курс іншої автошколи теж 404. ' +
      'Курс групи зі статусом COMPLETED або ARCHIVED змінювати не можна. ' +
      'Повтор того самого курсу (або null для групи без курсу) нічого не змінює. ' +
      'Відповідь містить групу з актуальним курсом.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id групи своєї автошколи.',
  })
  @ApiOkResponse({ type: GroupListItemDto })
  @ApiBadRequestResponse({
    description:
      'id не UUID, courseId відсутній або не UUID і не null, або зайві поля. ' +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({ description: 'Призначати курс може лише ADMIN.' })
  @ApiNotFoundResponse({
    description:
      'Групу або курс не знайдено, або вони належать іншій автошколі. ' +
      'Також якщо автошколу видалено.',
  })
  @ApiConflictResponse({
    description: 'Група закрита (COMPLETED/ARCHIVED) або курс архівовано.',
  })
  assignCourse(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: AssignGroupCourseDto,
  ) {
    return this.groupsService.assignCourse(user, id, body);
  }

  @Get(':id/students')
  @Roles(...GROUP_ROSTER_ROLES)
  @ApiOperation({
    summary: 'Склад навчальної групи',
    description:
      'Студенти з активним зарахуванням, відсортовані за прізвищем та ім’ям, разом з карткою групи. ' +
      'ADMIN бачить склад будь-якої групи своєї автошколи, TEACHER — лише групи, яку веде. ' +
      'Група іншої автошколи повертає 404.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id групи своєї автошколи.',
  })
  @ApiOkResponse({ type: GroupStudentsDto })
  @ApiBadRequestResponse({ description: 'id не UUID.' })
  @ApiForbiddenResponse({
    description:
      'Склад доступний лише ADMIN і викладачу цієї групи. Інші ролі та TEACHER чужої групи отримують 403.',
  })
  @ApiNotFoundResponse({
    description:
      'Групу не знайдено або вона належить іншій автошколі. Також якщо автошколу видалено.',
  })
  listStudents(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.groupsService.listStudents(user, id);
  }

  @Post(':id/students')
  @Roles(...GROUP_MANAGE_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Додати студента до навчальної групи',
    description:
      'ADMIN зараховує STUDENT своєї автошколи у відкриту (PLANNED або ACTIVE) групу. ' +
      'Студент не може бути в іншій відкритій групі; студент зі статусом ARCHIVED, DROPPED або GRADUATED не приймається. ' +
      'Повторне додавання студента, який уже в цій групі, нічого не змінює. ' +
      'Відповідь — актуальний склад групи після операції.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id групи своєї автошколи.',
  })
  @ApiOkResponse({ type: GroupStudentsDto })
  @ApiBadRequestResponse({
    description:
      'id не UUID, або studentId відсутній чи не UUID. Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description: 'Додавати студентів до групи може лише ADMIN.',
  })
  @ApiNotFoundResponse({
    description:
      'Групу або студента не знайдено, їх видалено, або вони належать іншій автошколі. ' +
      'Також якщо автошколу видалено.',
  })
  @ApiConflictResponse({
    description:
      'Група закрита (COMPLETED/ARCHIVED), студент уже в іншій відкритій групі, ' +
      'або студент має статус ARCHIVED, DROPPED чи GRADUATED.',
  })
  addStudent(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: AddGroupStudentDto,
  ) {
    return this.groupsService.addStudent(user, id, body);
  }

  @Delete(':id/students/:studentId')
  @Roles(...GROUP_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Видалити студента з навчальної групи',
    description:
      'ADMIN прибирає студента зі складу відкритої групи своєї автошколи: активне зарахування видаляється, ' +
      'а поточна група студента очищується. Навчальний статус студента не змінюється, і його можна знову ' +
      'зарахувати в будь-яку відкриту групу. Склад завершеної або архівної групи змінювати не можна. ' +
      'Випуск і відрахування робляться через PATCH /students/{id}/status. ' +
      'Відповідь — актуальний склад групи після операції.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id групи своєї автошколи.',
  })
  @ApiParam({
    name: 'studentId',
    format: 'uuid',
    description: 'Id користувача-студента.',
  })
  @ApiOkResponse({ type: GroupStudentsDto })
  @ApiBadRequestResponse({ description: 'id або studentId не UUID.' })
  @ApiForbiddenResponse({
    description: 'Видаляти студентів з групи може лише ADMIN.',
  })
  @ApiNotFoundResponse({
    description:
      'Групу або студента не знайдено, вони належать іншій автошколі, або студент не в цій групі. ' +
      'Також якщо автошколу видалено.',
  })
  @ApiConflictResponse({
    description: 'Група закрита (COMPLETED/ARCHIVED).',
  })
  removeStudent(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('studentId', new ParseUUIDPipe({ version: '4' })) studentId: string,
  ) {
    return this.groupsService.removeStudent(user, id, studentId);
  }
}
