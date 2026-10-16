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
import { User } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CourseListDto } from './courses.dto';
import { COURSE_LIST_ROLES, CoursesService } from './courses.service';

@ApiTags('courses')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@Controller('courses')
@UseGuards(AuthGuard, RolesGuard)
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Get()
  @Roles(...COURSE_LIST_ROLES)
  @ApiOperation({
    summary: 'Список теоретичних курсів своєї автошколи',
    description:
      'Усі курси організації поточного ADMIN, відсортовані за назвою: id, назва і статус. ' +
      'Групі можна призначити лише ACTIVE-курс (PATCH /groups/{id}/course). ' +
      'Курси інших організацій не повертаються. Якщо курсів немає, повертається порожній масив.',
  })
  @ApiOkResponse({ type: CourseListDto })
  @ApiForbiddenResponse({ description: 'Список курсів доступний лише ADMIN.' })
  @ApiNotFoundResponse({
    description: 'Автошколу не знайдено або її видалено.',
  })
  list(@CurrentUser() user: User) {
    return this.coursesService.list(user);
  }
}
