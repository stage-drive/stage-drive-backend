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
import { InviteAdminDto, InviteAdminResponseDto } from './invitations.dto';
import { InvitationsService } from './invitations.service';

@ApiTags('invitations')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@ApiForbiddenResponse({
  description: 'Лише OWNER може запрошувати адміністратора.',
})
@Controller('invitations')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.OWNER)
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: InviteAdminResponseDto })
  inviteAdmin(@CurrentUser() user: User, @Body() body: InviteAdminDto) {
    return this.invitationsService.inviteAdmin(user, body);
  }
}
