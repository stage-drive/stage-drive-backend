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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { User, UserStatus } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  AssignStudentGroupDto,
  CreateStudentDto,
  CreateStudentResponseDto,
  GrantPracticeAccessDto,
  ListStudentsQueryDto,
  SORT_ORDERS,
  STUDENT_SORT_FIELDS,
  StudentCardDto,
  StudentListDto,
  UpdateStudentDto,
  UpdateStudentTrainingStatusDto,
} from './students.dto';
import {
  STUDENT_ARCHIVE_ROLES,
  STUDENT_CARD_ROLES,
  STUDENT_CREATE_ROLES,
  STUDENT_LIST_ROLES,
  STUDENT_PRACTICE_ACCESS_ROLES,
  STUDENT_STATUS_ROLES,
  STUDENT_UPDATE_ROLES,
  StudentsService,
} from './students.service';

@ApiTags('students')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@Controller('students')
@UseGuards(AuthGuard, RolesGuard)
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Get()
  @Roles(...STUDENT_LIST_ROLES)
  @ApiOperation({
    summary: 'Список студентів своєї автошколи',
    description:
      'ADMIN, TEACHER і INSTRUCTOR отримують студентів лише своєї організації. ' +
      'Студент іншої автошколи, інші ролі та soft-delete у відповідь не потрапляють. ' +
      'Підтримуються search, фільтр status, sortBy/sortOrder і пагінація page/limit.',
  })
  @ApiQuery({ name: 'search', required: false, example: 'Петренко' })
  @ApiQuery({ name: 'status', required: false, enum: UserStatus })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: STUDENT_SORT_FIELDS,
    example: 'lastName',
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: SORT_ORDERS,
    example: 'asc',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiOkResponse({ type: StudentListDto })
  @ApiForbiddenResponse({
    description:
      'Список студентів доступний лише ADMIN, TEACHER або INSTRUCTOR.',
  })
  @ApiBadRequestResponse({
    description:
      'Некоректні query-параметри. Тіло містить errors: [{ field, message }].',
  })
  @ApiNotFoundResponse({
    description: 'Автошколу не знайдено або її видалено.',
  })
  list(@CurrentUser() user: User, @Query() query: ListStudentsQueryDto) {
    return this.studentsService.list(user, query);
  }

  @Post()
  @Roles(...STUDENT_CREATE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Створити учня і надіслати запрошення',
    description:
      'OWNER або ADMIN створює користувача з роллю STUDENT і статусом INVITED ' +
      'у своїй автошколі, профіль учня та запрошення. organizationId береться ' +
      'з авторизованого користувача. groupId записується, лише якщо група ' +
      'належить тій самій автошколі. instructorId і carId лишаються null. ' +
      'Лист із посиланням запрошення передається на відправку.',
  })
  @ApiCreatedResponse({ type: CreateStudentResponseDto })
  @ApiForbiddenResponse({
    description: 'Створювати учнів можуть лише OWNER або ADMIN.',
  })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло запиту. Тіло містить errors: [{ field, message }].',
  })
  @ApiConflictResponse({
    description: 'Користувач з таким email уже існує.',
  })
  @ApiNotFoundResponse({
    description:
      'Автошколу не знайдено, її видалено, або група не належить цій автошколі.',
  })
  create(@CurrentUser() user: User, @Body() body: CreateStudentDto) {
    return this.studentsService.create(user, body);
  }

  @Get(':id')
  @Roles(...STUDENT_CARD_ROLES)
  @ApiOperation({
    summary: 'Картка студента своєї автошколи',
    description:
      'id — це id користувача зі списку студентів. OWNER, ADMIN, TEACHER і ' +
      'INSTRUCTOR бачать лише студента своєї організації. Студент іншої ' +
      'автошколи, інша роль і soft-delete повертають 404. Пароль і службові ' +
      'поля у відповідь не потрапляють.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id користувача-студента.',
    example: '88888888-8888-4888-8888-888888888888',
  })
  @ApiOkResponse({ type: StudentCardDto })
  @ApiForbiddenResponse({
    description:
      'Картку студента можуть переглядати лише OWNER, ADMIN, TEACHER або INSTRUCTOR.',
  })
  @ApiNotFoundResponse({
    description:
      'Студента не знайдено, його видалено, або він належить іншій автошколі.',
  })
  getById(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.studentsService.getById(user, id);
  }

  @Patch(':id/group')
  @Roles(...STUDENT_UPDATE_ROLES)
  @ApiOperation({
    summary: 'Призначити студента до навчальної групи',
    description:
      'OWNER або ADMIN призначає студента своєї автошколи до групи тієї самої ' +
      'організації. Оновлюється student.groupId і створюється або поновлюється ' +
      'активне зарахування. Студент зі статусом ARCHIVED, з зарахуванням DROPPED ' +
      '(відрахований) або COMPLETED (GRADUATED) до нової групи не потрапляє. ' +
      'Групи ARCHIVED і COMPLETED не призначаються. Студент, який уже є в іншій ' +
      'активній групі, теж відхиляється.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id користувача-студента.',
    example: '88888888-8888-4888-8888-888888888888',
  })
  @ApiOkResponse({ type: StudentCardDto })
  @ApiForbiddenResponse({
    description: 'Призначати групу можуть лише OWNER або ADMIN.',
  })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло запиту. Тіло містить errors: [{ field, message }].',
  })
  @ApiConflictResponse({
    description:
      'Студент уже в іншій активній групі, має заборонений статус навчання ' +
      '(ARCHIVED, DROPPED або GRADUATED), або група ARCHIVED чи COMPLETED.',
  })
  @ApiNotFoundResponse({
    description:
      'Студента або групу не знайдено, їх видалено, або вони належать іншій автошколі.',
  })
  assignGroup(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: AssignStudentGroupDto,
  ) {
    return this.studentsService.assignGroup(user, id, body);
  }

  @Patch(':id/status')
  @Roles(...STUDENT_STATUS_ROLES)
  @ApiOperation({
    summary: 'Змінити навчальний статус студента',
    description:
      'Лише ADMIN своєї автошколи. organizationId береться з авторизованого ' +
      'користувача: студент іншої організації повертає 404. Обліковий status ' +
      'користувача (INVITED, ACTIVE, BLOCKED, ARCHIVED) цим запитом не змінюється. ' +
      'Дозволені переходи TrainingStatus: ' +
      'INVITED → ACTIVE | DROPPED | ARCHIVED; ' +
      'ACTIVE → GRADUATED | DROPPED | ARCHIVED; ' +
      'PRACTICE → GRADUATED | DROPPED | ARCHIVED; ' +
      'GRADUATED → ARCHIVED; DROPPED → ARCHIVED. ' +
      'PRACTICE цим запитом не призначається. ' +
      'GRADUATED закриває активні зарахування як COMPLETED, DROPPED — як DROPPED. ' +
      'Зміна пишеться в системний лог.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id користувача-студента.',
    example: '88888888-8888-4888-8888-888888888888',
  })
  @ApiOkResponse({ type: StudentCardDto })
  @ApiForbiddenResponse({
    description: 'Змінювати навчальний статус може лише ADMIN.',
  })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло запиту. status має бути значенням TrainingStatus.',
  })
  @ApiConflictResponse({
    description: 'Недозволений перехід навчального статусу.',
  })
  @ApiNotFoundResponse({
    description:
      'Студента не знайдено, його видалено, або він належить іншій автошколі. ' +
      'Також якщо автошколу видалено.',
  })
  changeTrainingStatus(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateStudentTrainingStatusDto,
  ) {
    return this.studentsService.changeTrainingStatus(user, id, body);
  }

  @Patch(':id/practice-access')
  @Roles(...STUDENT_PRACTICE_ACCESS_ROLES)
  @ApiOperation({
    summary: 'Надати студенту допуск до практичного навчання',
    description:
      'Лише ADMIN своєї автошколи. organizationId береться з авторизованого ' +
      'користувача. У тілі обов’язкові instructorId і carId. ' +
      'Студент має існувати в цій автошколі, мати обліковий статус ACTIVE, ' +
      'навчальний статус ACTIVE або PRACTICE, а також заповнені category і transmission. ' +
      'Інструктор має роль INSTRUCTOR, статус ACTIVE і ту саму організацію. ' +
      'Автомобіль належить вибраному інструктору, а його category і transmission ' +
      'збігаються зі студентом. Некоректна комбінація відхиляється. ' +
      'Після успіху встановлюються instructorId, carId і trainingStatus = PRACTICE.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id користувача-студента.',
    example: '88888888-8888-4888-8888-888888888888',
  })
  @ApiOkResponse({ type: StudentCardDto })
  @ApiForbiddenResponse({
    description: 'Допуск до практики надає лише ADMIN.',
  })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло запиту. instructorId і carId мають бути UUID. ' +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiConflictResponse({
    description:
      'Студент не має права на допуск, інструктор не INSTRUCTOR або не ACTIVE, ' +
      'або комбінація інструктора й автомобіля некоректна ' +
      '(авто не його, інша category або інша transmission).',
  })
  @ApiNotFoundResponse({
    description:
      'Студента, інструктора або автомобіль не знайдено, їх видалено, ' +
      'або вони належать іншій автошколі. Також якщо автошколу видалено.',
  })
  grantPracticeAccess(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: GrantPracticeAccessDto,
  ) {
    return this.studentsService.grantPracticeAccess(user, id, body);
  }

  @Patch(':id')
  @Roles(...STUDENT_UPDATE_ROLES)
  @ApiOperation({
    summary: 'Редагувати дозволені дані картки студента',
    description:
      'OWNER або ADMIN змінюють лише firstName, lastName і phone студента ' +
      'своєї автошколи. role, organizationId і системний status користувача ' +
      'цим запитом не змінюються і відхиляються, якщо їх передати в тілі.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id користувача-студента.',
    example: '88888888-8888-4888-8888-888888888888',
  })
  @ApiOkResponse({ type: StudentCardDto })
  @ApiForbiddenResponse({
    description: 'Редагувати картку студента можуть лише OWNER або ADMIN.',
  })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло або поле поза дозволеним набором. Тіло містить errors: [{ field, message }].',
  })
  @ApiNotFoundResponse({
    description:
      'Студента не знайдено, його видалено, або він належить іншій автошколі.',
  })
  update(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateStudentDto,
  ) {
    return this.studentsService.update(user, id, body);
  }

  @Delete(':id')
  @Roles(...STUDENT_ARCHIVE_ROLES)
  @ApiOperation({
    summary: 'Архівувати студента без фізичного видалення',
    description:
      'OWNER або ADMIN своєї автошколи. organizationId береться з авторизованого ' +
      'користувача: студент іншої організації повертає 404. Запис Student і User ' +
      'не видаляються і deletedAt не ставиться. Встановлюються ' +
      'Student.trainingStatus = ARCHIVED і User.status = ARCHIVED. ' +
      'Зарахування, заняття, оплати та практичні заняття лишаються в базі. ' +
      'Нове бронювання практики для архівованого студента відхиляється.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id користувача-студента.',
    example: '88888888-8888-4888-8888-888888888888',
  })
  @ApiOkResponse({ type: StudentCardDto })
  @ApiForbiddenResponse({
    description: 'Архівувати студента можуть лише OWNER або ADMIN.',
  })
  @ApiNotFoundResponse({
    description:
      'Студента не знайдено, його видалено, або він належить іншій автошколі. ' +
      'Також якщо автошколу видалено.',
  })
  archive(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.studentsService.archive(user, id);
  }
}
