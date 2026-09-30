import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
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
  ListStudentsQueryDto,
  SORT_ORDERS,
  STUDENT_SORT_FIELDS,
  StudentListDto,
} from './students.dto';
import { STUDENT_LIST_ROLES, StudentsService } from './students.service';

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
}
