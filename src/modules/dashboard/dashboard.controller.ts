import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
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
import { OwnerDashboardDto } from './dashboard.dto';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@ApiForbiddenResponse({
  description: 'Дані Owner Dashboard доступні лише OWNER.',
})
@Controller('dashboard')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.OWNER)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @ApiOperation({
    summary: 'Дані Owner Dashboard',
    description:
      'Зведення автошколи поточного OWNER: школа, кількість користувачів за роллю і статусом, ' +
      'активні та прострочені запрошення. Інші організації в відповідь не потрапляють. ' +
      'Якщо користувачів або запрошень немає, лічильники дорівнюють 0.',
  })
  @ApiOkResponse({ type: OwnerDashboardDto })
  @ApiNotFoundResponse({
    description: 'Автошколу не знайдено або її видалено.',
  })
  getOwnerDashboard(@CurrentUser() user: User) {
    return this.dashboardService.getOwnerDashboard(user);
  }
}
