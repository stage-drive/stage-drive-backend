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
  UpdateCoursePublicationDto,
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
      'Усі курси організації поточного ADMIN, відсортовані за назвою: id, назва, статус і publicationStatus. ' +
      'Повну структуру (розділи, уроки, матеріали) повертає GET /courses/{courseId}. ' +
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
      'Новий курс завжди має статус ACTIVE і publicationStatus DRAFT: студенти його ще не бачать. ' +
      'Назва унікальна серед активних курсів автошколи без урахування регістру. ' +
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
      'Статус, publicationStatus і organizationId цим запитом не змінюються.',
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

  @Patch(':id/publication')
  @Roles(...COURSE_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Опублікувати або зняти з публікації теоретичний курс',
    description:
      'ADMIN змінює publicationStatus курсу своєї автошколи. ' +
      'PUBLISHED відкриває розділи, уроки та матеріали студентам, у яких є активне зарахування ' +
      'в групу з цим курсом (GET /courses/current і GET /courses/{courseId}/content). ' +
      'DRAFT знову ховає контент, навіть якщо курс лишається призначеним групі. ' +
      'Повтор того самого статусу повертає курс без запису. ' +
      'ARCHIVED-курс опублікувати не можна. Курс іншої автошколи повертає 404. ' +
      'Відповідь містить збережений publicationStatus.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id курсу своєї автошколи.',
  })
  @ApiOkResponse({ type: CourseDto })
  @ApiBadRequestResponse({
    description:
      'id не UUID, publicationStatus відсутній або не DRAFT і не PUBLISHED, або зайві поля. ' +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description: 'Змінювати публікацію курсу може лише ADMIN.',
  })
  @ApiNotFoundResponse({
    description:
      'Курс не знайдено або він належить іншій автошколі. Також якщо автошколу видалено.',
  })
  @ApiConflictResponse({
    description: 'Архівований курс не можна опублікувати.',
  })
  changePublication(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateCoursePublicationDto,
  ) {
    return this.coursesService.changePublication(user, id, body);
  }
}
