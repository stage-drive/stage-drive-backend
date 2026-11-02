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
  ChapterDto,
  CourseStructureDto,
  CreateChapterDto,
  CreateLessonDto,
  CreateMaterialDto,
  LessonDto,
  MaterialDto,
  UpdateChapterDto,
  UpdateLessonDto,
  UpdateMaterialDto,
} from './course-structure.dto';
import { CourseStructureService } from './course-structure.service';
import { COURSE_MANAGE_ROLES, COURSE_STUDENT_ROLES } from './courses.service';

const courseIdParam = {
  name: 'courseId',
  format: 'uuid',
  description: 'Id теоретичного курсу своєї автошколи.',
} as const;

const chapterIdParam = {
  name: 'chapterId',
  format: 'uuid',
  description: 'Id розділу цього курсу.',
} as const;

const lessonIdParam = {
  name: 'lessonId',
  format: 'uuid',
  description: 'Id уроку цього розділу. Це не заняття групи.',
} as const;

const materialIdParam = {
  name: 'materialId',
  format: 'uuid',
  description: 'Id навчального матеріалу цього уроку.',
} as const;

const uuidPipe = new ParseUUIDPipe({ version: '4' });

@ApiTags('courses')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@Controller('courses')
@UseGuards(AuthGuard, RolesGuard)
export class CourseStructureController {
  constructor(private readonly structure: CourseStructureService) {}

  // Статичний шлях реєструється раніше за :courseId, інакше "current" стане id.
  @Get('current')
  @Roles(...COURSE_STUDENT_ROLES)
  @ApiOperation({
    summary: 'Опублікований теоретичний курс групи поточного студента',
    description:
      'STUDENT отримує курс групи, у якій у нього Enrollment.status = ACTIVE і групі призначено курс. ' +
      'Контент (розділи, уроки, матеріали за position) повертається лише якщо курс ACTIVE і PUBLISHED. ' +
      'DRAFT і ARCHIVED для студента недоступні. Студент без такої групи отримує 404. ' +
      'Інша роль отримує 403.',
  })
  @ApiOkResponse({ type: CourseStructureDto })
  @ApiForbiddenResponse({
    description:
      'Ендпоінт лише для STUDENT. Також 403, якщо курс групи ще не опубліковано або його архівовано.',
  })
  @ApiNotFoundResponse({
    description:
      'У студента немає групи з призначеним курсом, або автошколу видалено.',
  })
  getCurrent(@CurrentUser() user: User) {
    return this.structure.getCurrentStudentCourse(user);
  }

  @Get(':courseId/content')
  @Roles(...COURSE_STUDENT_ROLES)
  @ApiOperation({
    summary: 'Контент опублікованого курсу для студента своєї групи',
    description:
      'STUDENT бачить структуру курсу лише якщо курс його автошколи, ACTIVE, PUBLISHED ' +
      'і призначений групі, у якій у студента активне зарахування. ' +
      'Курс іншої автошколи або неіснуючий — 404. ' +
      'Курс своєї автошколи, який студенту не призначено, — 403, навіть якщо він опублікований. ' +
      'Призначений, але не опублікований курс — 403 без контенту.',
  })
  @ApiParam(courseIdParam)
  @ApiOkResponse({ type: CourseStructureDto })
  @ApiForbiddenResponse({
    description:
      'Ендпоінт лише для STUDENT. 403, якщо курс студенту не призначено, ще не опубліковано або архівовано.',
  })
  @ApiNotFoundResponse({
    description:
      'Курс не знайдено, він чужої автошколи, або автошколу видалено.',
  })
  getStudentContent(
    @CurrentUser() user: User,
    @Param('courseId', uuidPipe) courseId: string,
  ) {
    return this.structure.getStudentContent(user, courseId);
  }

  @Get(':courseId')
  @Roles(...COURSE_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Структура теоретичного курсу',
    description:
      'ADMIN отримує курс своєї автошколи разом із розділами, уроками, матеріалами і publicationStatus. ' +
      'Порядок — за position від 1. Курс іншої автошколи повертає 404. ' +
      'Порожній курс має chapters: []. Чернетка для ADMIN доступна. ' +
      'Студент читає лише опублікований курс своєї групи: GET /courses/current або GET /courses/{courseId}/content.',
  })
  @ApiParam(courseIdParam)
  @ApiOkResponse({ type: CourseStructureDto })
  @ApiForbiddenResponse({
    description: 'Структуру курсу бачить лише ADMIN.',
  })
  @ApiNotFoundResponse({
    description:
      'Курс не знайдено, він чужої автошколи, або автошколу видалено.',
  })
  getStructure(
    @CurrentUser() user: User,
    @Param('courseId', uuidPipe) courseId: string,
  ) {
    return this.structure.getStructure(user, courseId);
  }

  @Post(':courseId/chapters')
  @Roles(...COURSE_MANAGE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Створити розділ теоретичного курсу',
    description:
      'Розділ прив’язується до курсу з адреси. organizationId і courseId з тіла ігноруються. ' +
      'Без position розділ стає останнім. Позиція в середині зсуває наступні розділи.',
  })
  @ApiParam(courseIdParam)
  @ApiCreatedResponse({ type: ChapterDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло або position поза діапазоном. Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({ description: 'Створювати розділи може лише ADMIN.' })
  @ApiNotFoundResponse({
    description: 'Курс не знайдено або він належить іншій автошколі.',
  })
  createChapter(
    @CurrentUser() user: User,
    @Param('courseId', uuidPipe) courseId: string,
    @Body() body: CreateChapterDto,
  ) {
    return this.structure.createChapter(user, courseId, body);
  }

  @Patch(':courseId/chapters/:chapterId')
  @Roles(...COURSE_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Редагувати розділ теоретичного курсу',
    description:
      'Можна змінити title, description і position. Розділ чужого курсу або іншої автошколи повертає 404. ' +
      'null у description очищає опис.',
  })
  @ApiParam(courseIdParam)
  @ApiParam(chapterIdParam)
  @ApiOkResponse({ type: ChapterDto })
  @ApiBadRequestResponse({
    description:
      'Порожнє тіло, некоректні поля або position поза діапазоном. Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({ description: 'Редагувати розділи може лише ADMIN.' })
  @ApiNotFoundResponse({
    description: 'Курс або розділ не знайдено в цій автошколі.',
  })
  updateChapter(
    @CurrentUser() user: User,
    @Param('courseId', uuidPipe) courseId: string,
    @Param('chapterId', uuidPipe) chapterId: string,
    @Body() body: UpdateChapterDto,
  ) {
    return this.structure.updateChapter(user, courseId, chapterId, body);
  }

  @Post(':courseId/chapters/:chapterId/lessons')
  @Roles(...COURSE_MANAGE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Створити урок теоретичного курсу',
    description:
      'Урок прив’язується до курсу і розділу з адреси. Це не заняття групи (GET /groups не про цю сутність). ' +
      'Розділ іншого курсу повертає 404. Без position урок стає останнім у розділі.',
  })
  @ApiParam(courseIdParam)
  @ApiParam(chapterIdParam)
  @ApiCreatedResponse({ type: LessonDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло або position поза діапазоном. Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({ description: 'Створювати уроки може лише ADMIN.' })
  @ApiNotFoundResponse({
    description: 'Курс або розділ не знайдено в цій автошколі.',
  })
  createLesson(
    @CurrentUser() user: User,
    @Param('courseId', uuidPipe) courseId: string,
    @Param('chapterId', uuidPipe) chapterId: string,
    @Body() body: CreateLessonDto,
  ) {
    return this.structure.createLesson(user, courseId, chapterId, body);
  }

  @Patch(':courseId/chapters/:chapterId/lessons/:lessonId')
  @Roles(...COURSE_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Редагувати урок теоретичного курсу',
    description:
      'Можна змінити title, description і position усередині розділу. ' +
      'Урок іншого розділу або курсу повертає 404.',
  })
  @ApiParam(courseIdParam)
  @ApiParam(chapterIdParam)
  @ApiParam(lessonIdParam)
  @ApiOkResponse({ type: LessonDto })
  @ApiBadRequestResponse({
    description:
      'Порожнє тіло, некоректні поля або position поза діапазоном. Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({ description: 'Редагувати уроки може лише ADMIN.' })
  @ApiNotFoundResponse({
    description: 'Курс, розділ або урок не знайдено в цій автошколі.',
  })
  updateLesson(
    @CurrentUser() user: User,
    @Param('courseId', uuidPipe) courseId: string,
    @Param('chapterId', uuidPipe) chapterId: string,
    @Param('lessonId', uuidPipe) lessonId: string,
    @Body() body: UpdateLessonDto,
  ) {
    return this.structure.updateLesson(
      user,
      courseId,
      chapterId,
      lessonId,
      body,
    );
  }

  @Post(':courseId/chapters/:chapterId/lessons/:lessonId/materials')
  @Roles(...COURSE_MANAGE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Додати навчальний матеріал уроку',
    description:
      'Матеріал прив’язується до курсу й уроку з адреси. type TEXT зберігає текст, ' +
      'LINK і VIDEO вимагають http(s) URL у body. Без position матеріал стає останнім.',
  })
  @ApiParam(courseIdParam)
  @ApiParam(chapterIdParam)
  @ApiParam(lessonIdParam)
  @ApiCreatedResponse({ type: MaterialDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло, position поза діапазоном або body не відповідає type. Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description: 'Додавати матеріали може лише ADMIN.',
  })
  @ApiNotFoundResponse({
    description: 'Курс, розділ або урок не знайдено в цій автошколі.',
  })
  createMaterial(
    @CurrentUser() user: User,
    @Param('courseId', uuidPipe) courseId: string,
    @Param('chapterId', uuidPipe) chapterId: string,
    @Param('lessonId', uuidPipe) lessonId: string,
    @Body() body: CreateMaterialDto,
  ) {
    return this.structure.createMaterial(
      user,
      courseId,
      chapterId,
      lessonId,
      body,
    );
  }

  @Patch(
    ':courseId/chapters/:chapterId/lessons/:lessonId/materials/:materialId',
  )
  @Roles(...COURSE_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Редагувати навчальний матеріал уроку',
    description:
      'Можна змінити title, type, body і position. Матеріал іншого уроку повертає 404. ' +
      'Після зміни type на LINK або VIDEO body має бути http(s) адресою.',
  })
  @ApiParam(courseIdParam)
  @ApiParam(chapterIdParam)
  @ApiParam(lessonIdParam)
  @ApiParam(materialIdParam)
  @ApiOkResponse({ type: MaterialDto })
  @ApiBadRequestResponse({
    description:
      'Порожнє тіло, некоректні поля або body не відповідає type. Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description: 'Редагувати матеріали може лише ADMIN.',
  })
  @ApiNotFoundResponse({
    description: 'Курс, розділ, урок або матеріал не знайдено в цій автошколі.',
  })
  updateMaterial(
    @CurrentUser() user: User,
    @Param('courseId', uuidPipe) courseId: string,
    @Param('chapterId', uuidPipe) chapterId: string,
    @Param('lessonId', uuidPipe) lessonId: string,
    @Param('materialId', uuidPipe) materialId: string,
    @Body() body: UpdateMaterialDto,
  ) {
    return this.structure.updateMaterial(
      user,
      courseId,
      chapterId,
      lessonId,
      materialId,
      body,
    );
  }
}
