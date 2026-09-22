import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
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
  InvitationTokenErrorDto,
  InviteAdminDto,
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
      'Токен недійсний, прострочений або вже використаний. У тілі відповіді є `code`.',
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
      'Токен недійсний, прострочений або вже використаний, або пароль не пройшов валідацію. ' +
      'Помилка токена містить `code`, помилка полів форми — `errors`.',
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
    summary: 'OWNER запрошує ADMIN',
    description:
      'Тіло без role: запрошений завжди стає ADMIN. Викликати може лише OWNER.',
  })
  @ApiUnauthorizedResponse({ description: 'Потрібен access token' })
  @ApiCreatedResponse({ type: InviteResponseDto })
  @ApiForbiddenResponse({
    description: 'Лише OWNER може запрошувати адміністратора.',
  })
  inviteAdmin(@CurrentUser() user: User, @Body() body: InviteAdminDto) {
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
}
