import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { User, UserRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  ActivateInvitationDto,
  ActivateInvitationResponseDto,
  CreatedInvitationDto,
  InvitationListDto,
  InvitationTokenErrorDto,
  InviteByOwnerDto,
  InviteMemberDto,
  InviteResponseDto,
  VerifyInvitationDto,
  VerifyInvitationResponseDto,
} from './invitations.dto';
import { InvitationsService } from './invitations.service';

@ApiTags('invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Перевірити invitation token перед активацією акаунта',
    description:
      'Публічний ендпоінт. Не змінює статус запрошення. Фронтенд викликає його, ' +
      'щоб вирішити, чи показувати форму активації.',
  })
  @ApiOkResponse({ type: VerifyInvitationResponseDto })
  @ApiBadRequestResponse({
    description:
      'Токен недійсний (`INVALID_INVITATION_TOKEN`), прострочений (`EXPIRED_INVITATION_TOKEN`), ' +
      'скасований (`CANCELLED_INVITATION_TOKEN`) або вже використаний (`USED_INVITATION_TOKEN`).',
    type: InvitationTokenErrorDto,
  })
  verify(@Body() body: VerifyInvitationDto) {
    return this.invitationsService.verifyToken(body.token);
  }

  @Post('activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Активувати акаунт за invitation token і встановити пароль',
    description:
      'Публічний ендпоінт. Перевіряє запрошення, зберігає пароль і переводить ' +
      'користувача з INVITED в ACTIVE, а запрошення — в ACCEPTED.',
  })
  @ApiOkResponse({ type: ActivateInvitationResponseDto })
  @ApiBadRequestResponse({
    description:
      'Токен недійсний (`INVALID_INVITATION_TOKEN`), прострочений (`EXPIRED_INVITATION_TOKEN`), ' +
      'скасований (`CANCELLED_INVITATION_TOKEN`) або вже використаний (`USED_INVITATION_TOKEN`). ' +
      'Помилка пароля повертає `errors` по полях форми.',
    type: InvitationTokenErrorDto,
  })
  activate(@Body() body: ActivateInvitationDto) {
    return this.invitationsService.activate(body.token, body.password);
  }

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.OWNER)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'OWNER запрошує користувача в автошколу',
    description:
      'Необов’язкове поле role: ADMIN, TEACHER, INSTRUCTOR або STUDENT. ' +
      'Якщо role не передати, запрошений стає ADMIN. OWNER запросити не можна. ' +
      'Викликати може лише OWNER.',
  })
  @ApiUnauthorizedResponse({ description: 'Потрібен access token' })
  @ApiCreatedResponse({ type: InviteResponseDto })
  @ApiForbiddenResponse({
    description: 'Лише OWNER може запрошувати користувачів цим ендпоінтом.',
  })
  inviteAdmin(@CurrentUser() user: User, @Body() body: InviteByOwnerDto) {
    return this.invitationsService.inviteAdmin(user, body);
  }

  @Post('members')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'ADMIN запрошує TEACHER, INSTRUCTOR або STUDENT',
    description:
      'У body обов’язкове поле role: TEACHER | INSTRUCTOR | STUDENT. ' +
      'OWNER/ADMIN цим ендпоінтом запросити не можна. Викликати може лише ADMIN.',
  })
  @ApiUnauthorizedResponse({ description: 'Потрібен access token' })
  @ApiCreatedResponse({ type: InviteResponseDto })
  @ApiForbiddenResponse({
    description: 'Лише ADMIN може запрошувати TEACHER, INSTRUCTOR або STUDENT.',
  })
  inviteMember(@CurrentUser() user: User, @Body() body: InviteMemberDto) {
    return this.invitationsService.inviteMember(user, body);
  }

  @Get()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Список запрошень своєї автошколи',
    description:
      'OWNER бачить запрошення ADMIN, TEACHER, INSTRUCTOR і STUDENT. ' +
      'ADMIN бачить лише TEACHER, INSTRUCTOR і STUDENT. Сирий token не повертається.',
  })
  @ApiUnauthorizedResponse({ description: 'Потрібен access token' })
  @ApiOkResponse({ type: InvitationListDto })
  @ApiForbiddenResponse({
    description: 'Лише OWNER або ADMIN можуть переглядати запрошення.',
  })
  list(@CurrentUser() user: User) {
    return this.invitationsService.list(user);
  }

  @Get(':id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Отримати запрошення за id',
    description:
      'Те саме обмеження ролей, що й у списку. Запрошення іншої автошколи — 404.',
  })
  @ApiUnauthorizedResponse({ description: 'Потрібен access token' })
  @ApiOkResponse({ type: CreatedInvitationDto })
  @ApiForbiddenResponse({
    description: 'Недостатньо прав, щоб переглянути це запрошення.',
  })
  @ApiNotFoundResponse({ description: 'Запрошення не знайдено.' })
  getById(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.invitationsService.getById(user, id);
  }

  @Post(':id/cancel')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Скасувати запрошення',
    description:
      'OWNER скасовує запрошення ADMIN. ADMIN скасовує запрошення TEACHER, ' +
      'INSTRUCTOR або STUDENT. Після цього verify/activate повертають ' +
      'CANCELLED_INVITATION_TOKEN. Повторне скасування — 400.',
  })
  @ApiUnauthorizedResponse({ description: 'Потрібен access token' })
  @ApiOkResponse({ type: CreatedInvitationDto })
  @ApiForbiddenResponse({
    description: 'Недостатньо прав, щоб скасувати це запрошення.',
  })
  @ApiNotFoundResponse({ description: 'Запрошення не знайдено.' })
  @ApiBadRequestResponse({
    description:
      'Запрошення вже скасоване або вже використане (користувач не в статусі INVITED).',
  })
  cancel(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.invitationsService.cancel(user, id);
  }
}
