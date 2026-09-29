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
import { AdminDashboardDto, InstructorDashboardDto, OwnerDashboardDto, StudentDashboardDto, TeacherDashboardDto } from './dashboard.dto';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@Controller('dashboard')
@UseGuards(AuthGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @Roles(UserRole.OWNER)
  @ApiOperation({
    summary: 'Дані Owner Dashboard',
    description:
      'Зведення автошколи поточного OWNER: школа, кількість користувачів за роллю і статусом, ' +
      'активні та прострочені запрошення. Інші організації в відповідь не потрапляють. ' +
      'Якщо користувачів або запрошень немає, лічильники дорівнюють 0.',
  })
  @ApiOkResponse({ type: OwnerDashboardDto })
  @ApiForbiddenResponse({
    description: 'Дані Owner Dashboard доступні лише OWNER.',
  })
  @ApiNotFoundResponse({
    description: 'Автошколу не знайдено або її видалено.',
  })
  getOwnerDashboard(@CurrentUser() user: User) {
    return this.dashboardService.getOwnerDashboard(user);
  }

  @Get('admin')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Дані Admin Dashboard',
    description:
      'Зведення автошколи поточного ADMIN: публічні дані школи, кількість TEACHER, INSTRUCTOR і STUDENT ' +
      'за роллю та статусом, активні та прострочені запрошення цих ролей. ' +
      'Лічильники OWNER і ADMIN, запрошення адміністраторів і статус організації не повертаються. ' +
      'Інші організації в відповідь не потрапляють. Якщо учасників або запрошень немає, лічильники дорівнюють 0.',
  })
  @ApiOkResponse({ type: AdminDashboardDto })
  @ApiForbiddenResponse({
    description: 'Дані Admin Dashboard доступні лише ADMIN.',
  })
  @ApiNotFoundResponse({
    description: 'Автошколу не знайдено або її видалено.',
  })
  getAdminDashboard(@CurrentUser() user: User) {
    return this.dashboardService.getAdminDashboard(user);
  }

  @Get('teacher')
  @Roles(UserRole.TEACHER)
  @ApiOperation({
    summary: 'Дані Teacher Dashboard',
    description:
      'Публічні дані школи й власний профіль поточного TEACHER. Дані інших користувачів ' +
      '(інших TEACHER, INSTRUCTOR, STUDENT, ADMIN, OWNER) не повертаються. ' +
      'Інші організації в відповідь не потрапляють.',
  })
  @ApiOkResponse({ type: TeacherDashboardDto })
  @ApiForbiddenResponse({ description: 'Дані Teacher Dashboard доступні лише TEACHER.' })
  @ApiNotFoundResponse({ description: 'Автошколу не знайдено або її видалено.' })
  getTeacherDashboard(@CurrentUser() user: User) {
    return this.dashboardService.getTeacherDashboard(user);
  }

  @Get('student')
  @Roles(UserRole.STUDENT)
  @ApiOperation({
    summary: 'Дані Student Dashboard',
    description:
      'Групи, в яких студент активно навчається, викладач кожної групи, найближчі заняття. ' +
      'Дані інших студентів, груп чи занять, до яких студент не має стосунку, не повертаються.',
  })
  @ApiOkResponse({ type: StudentDashboardDto })
  @ApiForbiddenResponse({ description: 'Дані Student Dashboard доступні лише STUDENT.' })
  @ApiNotFoundResponse({ description: 'Автошколу не знайдено або її видалено.' })
  getStudentDashboard(@CurrentUser() user: User) {
    return this.dashboardService.getStudentDashboard(user);
  }

  @Get('instructor')
  @Roles(UserRole.INSTRUCTOR)
  @ApiOperation({
    summary: 'Дані Instructor Dashboard',
    description:
      'Публічні дані школи й власний профіль поточного INSTRUCTOR. Дані інших користувачів не повертаються.',
  })
  @ApiOkResponse({ type: InstructorDashboardDto })
  @ApiForbiddenResponse({ description: 'Дані Instructor Dashboard доступні лише INSTRUCTOR.' })
  @ApiNotFoundResponse({ description: 'Автошколу не знайдено або її видалено.' })
  getInstructorDashboard(@CurrentUser() user: User) {
    return this.dashboardService.getInstructorDashboard(user);
  }
}