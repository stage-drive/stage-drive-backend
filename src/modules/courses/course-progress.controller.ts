import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiBadRequestResponse,
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
  CourseProgressDto,
  SubmitTheoryTestDto,
  TheoryTestResultDto,
} from './course-progress.dto';
import {
  COURSE_PROGRESS_STAFF_ROLES,
  CourseProgressService,
} from './course-progress.service';
import { COURSE_STUDENT_ROLES } from './courses.service';

const courseIdParam = {
  name: 'courseId',
  format: 'uuid',
  description: 'Id теоретичного курсу.',
} as const;

const lessonIdParam = {
  name: 'lessonId',
  format: 'uuid',
  description: 'Id уроку теоретичного курсу. Це не заняття групи.',
} as const;

const studentIdParam = {
  name: 'studentId',
  format: 'uuid',
  description: 'Id користувача-студента своєї автошколи.',
} as const;

const uuidPipe = new ParseUUIDPipe({ version: '4' });

@ApiTags('courses')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@Controller('courses')
@UseGuards(AuthGuard, RolesGuard)
export class CourseProgressController {
  constructor(private readonly progress: CourseProgressService) {}

  @Get('current/progress')
  @Roles(...COURSE_STUDENT_ROLES)
  @ApiOperation({
    summary: 'Власний прогрес по теоретичному курсу поточної групи',
    description:
      'STUDENT отримує прогрес курсу групи, у якій у нього Enrollment.status = ACTIVE і групі призначено курс. ' +
      'Курс має бути ACTIVE і PUBLISHED, інакше 403. Студент без такої групи отримує 404. ' +
      'Відповідь рахується з пройдених уроків і поточного складу курсу. ' +
      'Інша роль отримує 403.',
  })
  @ApiOkResponse({ type: CourseProgressDto })
  @ApiForbiddenResponse({
    description:
      'Ендпоінт лише для STUDENT. Також 403, якщо курс групи ще не опубліковано або його архівовано.',
  })
  @ApiNotFoundResponse({
    description:
      'У студента немає групи з призначеним курсом, або автошколу видалено.',
  })
  getCurrent(@CurrentUser() user: User) {
    return this.progress.getCurrent(user);
  }

  @Get(':courseId/progress')
  @Roles(...COURSE_STUDENT_ROLES)
  @ApiOperation({
    summary: 'Власний прогрес студента по теоретичному курсу',
    description:
      'STUDENT бачить лише свій прогрес. studentId береться з access token. ' +
      'Курс має належати його автошколі, бути ACTIVE і PUBLISHED і бути призначеним групі ' +
      'з активним зарахуванням цього студента. Курс іншої автошколи або неіснуючий — 404. ' +
      'Курс своєї автошколи, який студенту не призначено, — 403. ' +
      'Призначений, але не опублікований курс — 403.',
  })
  @ApiParam(courseIdParam)
  @ApiOkResponse({ type: CourseProgressDto })
  @ApiForbiddenResponse({
    description:
      'Ендпоінт лише для STUDENT. 403, якщо курс студенту не призначено, ще не опубліковано або архівовано.',
  })
  @ApiNotFoundResponse({
    description:
      'Курс не знайдено, він чужої автошколи, або автошколу видалено.',
  })
  getOwn(
    @CurrentUser() user: User,
    @Param('courseId', uuidPipe) courseId: string,
  ) {
    return this.progress.getOwn(user, courseId);
  }

  @Post(':courseId/lessons/:lessonId/complete')
  @Roles(...COURSE_STUDENT_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Позначити урок теоретичного курсу пройденим',
    description:
      'STUDENT зберігає проходження уроку свого опублікованого курсу. Тіла немає. ' +
      'Урок має належати курсу з адреси. Повторний запит не створює другий запис і не змінює completedAt. ' +
      'Після запису перераховується збережений прогрес. Якщо пройдені всі уроки опублікованого курсу ' +
      'і тест цього курсу має статус PASSED, система ставить навчальний статус THEORY_COMPLETED. ' +
      'Журнал очної відвідуваності на цей статус не впливає. ' +
      'Відповідь — актуальний прогрес по всьому курсу, включно зі статусом кожного уроку. ' +
      'Курс іншої автошколи — 404. Чужий або неіснуючий урок цього курсу — 404. ' +
      'Курс не призначено, ще не опубліковано або архівовано — 403.',
  })
  @ApiParam(courseIdParam)
  @ApiParam(lessonIdParam)
  @ApiOkResponse({ type: CourseProgressDto })
  @ApiForbiddenResponse({
    description:
      'Проходити уроки може лише STUDENT, якому цей опублікований курс призначено групою.',
  })
  @ApiNotFoundResponse({
    description:
      'Курс або урок не знайдено в автошколі студента, або автошколу видалено.',
  })
  completeLesson(
    @CurrentUser() user: User,
    @Param('courseId', uuidPipe) courseId: string,
    @Param('lessonId', uuidPipe) lessonId: string,
  ) {
    return this.progress.completeLesson(user, courseId, lessonId);
  }

  @Post(':courseId/test')
  @Roles(...COURSE_STUDENT_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Зберегти результат теоретичного тесту курсу',
    description:
      'STUDENT записує актуальний результат тесту свого опублікованого курсу. ' +
      'Повторний запит перезаписує попередній результат. ' +
      'Якщо статус PASSED і всі уроки курсу вже пройдені, система ставить THEORY_COMPLETED. ' +
      'Відвідуваність очних занять не враховується.',
  })
  @ApiParam(courseIdParam)
  @ApiOkResponse({ type: TheoryTestResultDto })
  @ApiBadRequestResponse({
    description: 'status має бути PASSED або FAILED. score — ціле від 0 до 100.',
  })
  @ApiForbiddenResponse({
    description:
      'Тест здає лише STUDENT, якому цей опублікований курс призначено групою.',
  })
  @ApiNotFoundResponse({
    description: 'Курс не знайдено в автошколі студента, або автошколу видалено.',
  })
  submitTest(
    @CurrentUser() user: User,
    @Param('courseId', uuidPipe) courseId: string,
    @Body() body: SubmitTheoryTestDto,
  ) {
    return this.progress.submitTest(user, courseId, body);
  }

  @Get(':courseId/students/:studentId/progress')
  @Roles(...COURSE_PROGRESS_STAFF_ROLES)
  @ApiOperation({
    summary: 'Прогрес студента по теоретичному курсу',
    description:
      'ADMIN бачить прогрес студента своєї автошколи, якщо в нього є зарахування ACTIVE або COMPLETED ' +
      'у групу цієї автошколи з цим курсом. TEACHER бачить лише студента групи, яку він веде і якій призначено цей курс. ' +
      'Студент або курс іншої автошколи, видалений користувач і користувач не з роллю STUDENT — 404. ' +
      'Студент своєї автошколи без такого зарахування — 404. ' +
      'TEACHER без права на групу цього студента — 403. ' +
      'Відповідь містить збережений актуальний прогрес і проходження кожного уроку.',
  })
  @ApiParam(courseIdParam)
  @ApiParam(studentIdParam)
  @ApiOkResponse({ type: CourseProgressDto })
  @ApiForbiddenResponse({
    description:
      'Ендпоінт доступний ADMIN і TEACHER. TEACHER отримує 403, якщо студент навчається на цьому курсі в чужій групі.',
  })
  @ApiNotFoundResponse({
    description:
      'Курс або студента не знайдено в цій автошколі, студент не зарахований на курс, або автошколу видалено.',
  })
  getForStudent(
    @CurrentUser() user: User,
    @Param('courseId', uuidPipe) courseId: string,
    @Param('studentId', uuidPipe) studentId: string,
  ) {
    return this.progress.getForStudent(user, courseId, studentId);
  }
}
