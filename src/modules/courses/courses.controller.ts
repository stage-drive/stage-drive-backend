import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { User } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  CourseDto,
  CourseListDto,
  CreateCourseDto,
  UpdateCourseDto,
} from './courses.dto';
import {
  COURSE_LIST_ROLES,
  COURSE_MANAGE_ROLES,
  CoursesService,
} from './courses.service';

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

  @Post()
  @Roles(...COURSE_MANAGE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Створити теоретичний курс своєї автошколи',
    description:
      'ADMIN створює курс у своїй організації. organizationId береться з access token і не приймається в тілі. ' +
      'Новий курс завжди має статус ACTIVE. Назва унікальна серед активних курсів автошколи без урахування регістру. ' +
      'Опис необов’язковий: порожній рядок зберігається як null.',
  })
  @ApiCreatedResponse({ type: CourseDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло запиту. Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({ description: 'Створювати курси може лише ADMIN.' })
  @ApiNotFoundResponse({
    description: 'Автошколу не знайдено або її видалено.',
  })
  @ApiConflictResponse({
    description:
      'Активний курс з такою назвою вже є. Тіло містить errors: [{ field: name, message }].',
  })
  create(@CurrentUser() user: User, @Body() body: CreateCourseDto) {
    return this.coursesService.create(user, body);
  }

  @Patch(':id')
  @Roles(...COURSE_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Редагувати теоретичний курс своєї автошколи',
    description:
      'ADMIN змінює name або description курсу своєї організації. ' +
      'Курс іншої автошколи повертає 404. null у description очищає опис. ' +
      'Статус і organizationId цим запитом не змінюються.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id курсу своєї автошколи.',
  })
  @ApiOkResponse({ type: CourseDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло, порожнє тіло або id не UUID. Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({ description: 'Редагувати курси може лише ADMIN.' })
  @ApiNotFoundResponse({
    description:
      'Курс не знайдено або він належить іншій автошколі. Також якщо автошколу видалено.',
  })
  @ApiConflictResponse({
    description:
      'Активний курс з такою назвою вже є. Тіло містить errors: [{ field: name, message }].',
  })
  update(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateCourseDto,
  ) {
    return this.coursesService.update(user, id, body);
  }
}
