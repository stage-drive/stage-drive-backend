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

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.OWNER)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
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
  @ApiUnauthorizedResponse({ description: 'Потрібен access token' })
  @ApiCreatedResponse({ type: InviteResponseDto })
  @ApiForbiddenResponse({
    description: 'Лише ADMIN може запрошувати TEACHER, INSTRUCTOR або STUDENT.',
  })
  inviteMember(@CurrentUser() user: User, @Body() body: InviteMemberDto) {
    return this.invitationsService.inviteMember(user, body);
  }
}
