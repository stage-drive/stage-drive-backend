import {
  BadRequestException,
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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { User, UserRole, UserStatus } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  IMAGE_MAX_SIZE,
  imageFileFilter,
  imageStorage,
  publicUploadUrl,
} from '../../common/files/image-upload';
import { EmailChangeService } from './email-change.service';
import { MEMBER_MANAGE_ROLES, UsersService } from './users.service';
import {
  ChangeEmailDto,
  ChangePasswordDto,
  ListOrganizationMembersQueryDto,
  MEMBER_SORT_FIELDS,
  MEMBER_SORT_ORDERS,
  MessageResponseDto,
  OrganizationMemberDto,
  OrganizationMemberListDto,
  PublicUserDto,
  UpdateOrganizationMemberDto,
  UpdateOrganizationMemberStatusDto,
  UpdateProfileDto,
  VerifyEmailDto,
} from './users.dto';

@ApiTags('users')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@Controller('users')
@UseGuards(AuthGuard, RolesGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly emailChangeService: EmailChangeService,
  ) {}

  @Get('me')
  @ApiOkResponse({ type: PublicUserDto })
  getMe(@CurrentUser() user: User) {
    return this.usersService.getMe(user);
  }

  @Patch('me')
  @ApiOkResponse({ type: PublicUserDto })
  updateMe(@CurrentUser() user: User, @Body() body: UpdateProfileDto) {
    return this.usersService.updateMe(user, body);
  }

  @Post('me/avatar')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOkResponse({ type: PublicUserDto })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: imageStorage('avatars'),
      fileFilter: imageFileFilter,
      limits: { fileSize: IMAGE_MAX_SIZE },
    }),
  )
  uploadAvatar(
    @CurrentUser() user: User,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    return this.usersService.setAvatar(
      user,
      publicUploadUrl('avatars', file.filename),
    );
  }

  @Delete('me/avatar')
  @ApiOkResponse({ type: PublicUserDto })
  deleteAvatar(@CurrentUser() user: User) {
    return this.usersService.deleteAvatar(user);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteUser(@CurrentUser() user: User) {
    return this.usersService.deleteUser(user);
  }

  @Patch('me/password')
  @ApiOkResponse({ type: MessageResponseDto })
  changePassword(@CurrentUser() user: User, @Body() body: ChangePasswordDto) {
    return this.usersService.changePassword(
      user,
      body.currentPassword ?? '',
      body.newPassword ?? '',
    );
  }

  @Post('me/email/change')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MessageResponseDto })
  changeEmail(@CurrentUser() user: User, @Body() body: ChangeEmailDto) {
    return this.emailChangeService.requestEmailChange(
      user,
      body.newEmail,
      body.currentPassword,
    );
  }

  @Post('me/email/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MessageResponseDto })
  verifyEmail(@CurrentUser() user: User, @Body() body: VerifyEmailDto) {
    return this.emailChangeService.verifyEmailChange(user, body.token);
  }

  @Get()
  @Roles(...MEMBER_MANAGE_ROLES)
  @ApiOperation({
    operationId: 'listOrganizationMembers',
    summary: 'Список учасників своєї автошколи',
    description:
      'Розділ «Користувачі». OWNER бачить ADMIN, TEACHER, INSTRUCTOR і STUDENT. ' +
      'ADMIN бачить TEACHER, INSTRUCTOR і STUDENT. ' +
      'Власник і сам актор у список не входять: власний профіль — GET /api/users/me. ' +
      'Повертаються статуси INVITED, ACTIVE, BLOCKED і ARCHIVED, включно з деактивованими. ' +
      'INVITED — акаунт уже створено запрошенням, але ще не активовано. ' +
      'Доставка листа, скасування і повторна відправка лишаються в /api/invitations; ' +
      'id запрошення є в полі invitation. ' +
      'organizationId береться з access token. Soft-delete не повертається. ' +
      'Для INSTRUCTOR поле cars — автомобілі, де він призначений інструктором. ' +
      'Призначення змінює PATCH /api/cars/{carId}/instructor, не цей запит. ' +
      'Підтримуються search, фільтри role і status, sortBy/sortOrder і пагінація page/limit.',
  })
  @ApiQuery({ name: 'search', required: false, example: 'Коваль' })
  @ApiQuery({
    name: 'role',
    required: false,
    enum: UserRole,
    example: UserRole.INSTRUCTOR,
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: UserStatus,
    description:
      'Без параметра повертаються INVITED, ACTIVE, BLOCKED і ARCHIVED.',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: MEMBER_SORT_FIELDS,
    example: 'lastName',
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: MEMBER_SORT_ORDERS,
    example: 'asc',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiOkResponse({ type: OrganizationMemberListDto })
  @ApiForbiddenResponse({
    description: 'Список учасників доступний лише OWNER або ADMIN.',
  })
  @ApiBadRequestResponse({
    description:
      'Некоректні query-параметри або роль поза правами актора. ' +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiNotFoundResponse({
    description: 'Автошколу не знайдено або її видалено.',
  })
  list(
    @CurrentUser() user: User,
    @Query() query: ListOrganizationMembersQueryDto,
  ) {
    return this.usersService.listMembers(user, query);
  }

  @Get(':id')
  @Roles(...MEMBER_MANAGE_ROLES)
  @ApiOperation({
    operationId: 'getOrganizationMember',
    summary: 'Профіль учасника своєї автошколи',
    description:
      'Той самий доступ, що й у списку. Користувач іншої автошколи або soft-delete — 404. ' +
      'Роль, яку актор не може керувати, — 403. Власний обліковий запис — 403, ' +
      'його читає GET /api/users/me. ' +
      'Для INSTRUCTOR у cars перелічені призначені автомобілі. ' +
      'Змінити призначення: PATCH /api/cars/{carId}/instructor ' +
      '(автомобіль має бути AVAILABLE, інструктор — ACTIVE).',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id учасника своєї автошколи.',
    example: '77777777-7777-4777-8777-777777777777',
  })
  @ApiOkResponse({ type: OrganizationMemberDto })
  @ApiForbiddenResponse({
    description:
      'Недостатньо прав для цієї ролі, або це власний обліковий запис.',
  })
  @ApiNotFoundResponse({
    description:
      'Користувача не знайдено, його видалено, або він належить іншій автошколі. ' +
      'Також якщо автошколу видалено.',
  })
  getById(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.usersService.getMember(user, id);
  }

  @Patch(':id')
  @Roles(...MEMBER_MANAGE_ROLES)
  @ApiOperation({
    operationId: 'updateOrganizationMember',
    summary: 'Редагувати ім’я, прізвище і телефон учасника',
    description:
      'OWNER або ADMIN змінюють firstName, lastName і phone учасника своєї автошколи, ' +
      'включно зі статусом INVITED. Потрібно хоча б одне поле. null у phone очищує телефон. ' +
      'email цим запитом не змінюється. Для активного акаунта email змінює лише сам ' +
      'користувач: POST /api/users/me/email/change і POST /api/users/me/email/verify. ' +
      'Email запрошеного є частиною запрошення: щоб виправити адресу, запрошення ' +
      'скасовують (POST /api/invitations/{id}/cancel) і створюють нове. ' +
      'role теж не змінюється. Роль задається під час запрошення і впливає на профіль учня, ' +
      'групи, уроки водіння й автомобілі інструктора. ' +
      'Автомобіль інструктору цим запитом не призначається: ' +
      'PATCH /api/cars/{carId}/instructor. ' +
      'Поля email і role у тілі відхиляються як невідомі. ' +
      'Чужа автошкола і soft-delete — 404. Роль поза правами актора — 403. ' +
      'Власний обліковий запис — 403, його редагує PATCH /api/users/me.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id учасника своєї автошколи.',
    example: '77777777-7777-4777-8777-777777777777',
  })
  @ApiOkResponse({ type: OrganizationMemberDto })
  @ApiForbiddenResponse({
    description:
      'Недостатньо прав для цієї ролі, або це власний обліковий запис.',
  })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло, невідоме поле (зокрема email або role) або немає жодного ' +
      'дозволеного поля. Тіло містить errors: [{ field, message }].',
  })
  @ApiNotFoundResponse({
    description:
      'Користувача не знайдено, його видалено, або він належить іншій автошколі. ' +
      'Також якщо автошколу видалено.',
  })
  update(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateOrganizationMemberDto,
  ) {
    return this.usersService.updateMember(user, id, body);
  }

  @Patch(':id/status')
  @Roles(...MEMBER_MANAGE_ROLES)
  @ApiOperation({
    operationId: 'changeOrganizationMemberStatus',
    summary: 'Змінити статус учасника',
    description:
      'Дозволені статуси: ACTIVE, BLOCKED, ARCHIVED. ' +
      'Переходи: ACTIVE → BLOCKED | ARCHIVED; BLOCKED → ACTIVE | ARCHIVED; ' +
      'ARCHIVED → ACTIVE. Повтор того самого статусу нічого не змінює і сесії не скидає. ' +
      'INVITED цим запитом не змінюється: активація — POST /api/invitations/activate, ' +
      'скасування — POST /api/invitations/{id}/cancel. ' +
      'BLOCKED і ARCHIVED не можуть увійти. При переході в ці статуси refresh-токени ' +
      'відкликаються, а раніше видані access-токени стають недійсними. ' +
      'Повернення в ACTIVE не відновлює старі сесії: потрібен новий вхід. ' +
      'Призначені автомобілі інструктора не знімаються. Нове призначення можливе ' +
      'лише для інструктора зі статусом ACTIVE через PATCH /api/cars/{carId}/instructor. ' +
      'Не можна змінити статус собі і користувачу з роллю OWNER. ' +
      'ADMIN не змінює статус іншого ADMIN.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id учасника своєї автошколи.',
    example: '77777777-7777-4777-8777-777777777777',
  })
  @ApiOkResponse({ type: OrganizationMemberDto })
  @ApiForbiddenResponse({
    description:
      'Недостатньо прав для цієї ролі, або це власний обліковий запис.',
  })
  @ApiBadRequestResponse({
    description:
      'status має бути ACTIVE, BLOCKED або ARCHIVED. ' +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiConflictResponse({
    description:
      'Недозволений перехід. Зокрема статус INVITED не змінюється цим запитом, ' +
      'а ARCHIVED не переходить одразу в BLOCKED.',
  })
  @ApiNotFoundResponse({
    description:
      'Користувача не знайдено, його видалено, або він належить іншій автошколі. ' +
      'Також якщо автошколу видалено.',
  })
  changeStatus(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateOrganizationMemberStatusDto,
  ) {
    return this.usersService.changeMemberStatus(user, id, body.status);
  }
}
