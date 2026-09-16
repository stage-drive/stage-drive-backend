import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { User, UserRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  InviteAdminDto,
  InviteMemberDto,
  InviteResponseDto,
} from './invitations.dto';
import { InvitationsService } from './invitations.service';

@ApiTags('invitations')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@Controller('invitations')
@UseGuards(AuthGuard, RolesGuard)
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post()
  @Roles(UserRole.OWNER)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: InviteResponseDto })
  @ApiForbiddenResponse({
    description: 'Лише OWNER може запрошувати адміністратора.',
  })
  inviteAdmin(@CurrentUser() user: User, @Body() body: InviteAdminDto) {
    return this.invitationsService.inviteAdmin(user, body);
  }

  @Post('members')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: InviteResponseDto })
  @ApiForbiddenResponse({
    description: 'Лише ADMIN може запрошувати TEACHER, INSTRUCTOR або STUDENT.',
  })
  inviteMember(@CurrentUser() user: User, @Body() body: InviteMemberDto) {
    return this.invitationsService.inviteMember(user, body);
  }
}
