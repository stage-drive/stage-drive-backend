import {
  Body,
  Controller,
  Delete,
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
  AttemptConflictDto,
  AttemptDetailDto,
  StaffTestResultDto,
  StaffTestResultListDto,
  SubmitAttemptDto,
  TestOutcomeDto,
} from './test-attempts.dto';
import {
  TEST_RESULT_STAFF_ROLES,
  TestAttemptsService,
} from './test-attempts.service';
import {
  AnswerOptionDto,
  CreateAnswerOptionDto,
  CreateQuestionDto,
  CreateTestDto,
  QuestionDto,
  StudentTestDetailDto,
  StudentTestListDto,
  TestDetailDto,
  TestDto,
  TestListDto,
  UpdateAnswerOptionDto,
  UpdateQuestionDto,
  UpdateTestDto,
  UpdateTestPublicationDto,
} from './tests.dto';
import {
  TEST_MANAGE_ROLES,
  TEST_STUDENT_ROLES,
  TestsService,
} from './tests.service';

const testIdParam = {
  name: 'testId',
  format: 'uuid',
  description: 'Id тесту своєї автошколи.',
} as const;

const questionIdParam = {
  name: 'questionId',
  format: 'uuid',
  description: 'Id питання цього тесту.',
} as const;

const optionIdParam = {
  name: 'optionId',
  format: 'uuid',
  description: 'Id варіанта відповіді цього питання.',
} as const;

const attemptIdParam = {
  name: 'attemptId',
  format: 'uuid',
  description: 'Id спроби цього студента і цього тесту.',
} as const;

const resultStudentIdParam = {
  name: 'studentId',
  format: 'uuid',
  description: 'Id студента своєї автошколи.',
} as const;

const uuidPipe = new ParseUUIDPipe({ version: '4' });

@ApiTags('tests')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@Controller('tests')
@UseGuards(AuthGuard, RolesGuard)
export class TestsController {
  constructor(
    private readonly testsService: TestsService,
    private readonly attemptsService: TestAttemptsService,
  ) {}

  @Get()
  @Roles(...TEST_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Список теоретичних тестів своєї автошколи',
    description:
      'Усі тести організації поточного ADMIN: назва, курс, формат, поріг, ліміт часу, ' +
      'перемішування, статус публікації і кількість питань. Тести інших організацій не повертаються.',
  })
  @ApiOkResponse({ type: TestListDto })
  @ApiForbiddenResponse({ description: 'Список тестів доступний лише ADMIN.' })
  @ApiNotFoundResponse({
    description: 'Автошколу не знайдено або її видалено.',
  })
  list(@CurrentUser() user: User) {
    return this.testsService.list(user);
  }

  @Post()
  @Roles(...TEST_MANAGE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Створити теоретичний тест',
    description:
      'ADMIN створює тест у своїй організації. organizationId береться з access token і не приймається в тілі. ' +
      'courseId має належати цій автошколі. Новий тест завжди DRAFT. ' +
      'Зберігаються назва, опис, формат (SINGLE_CHOICE, MULTIPLE_CHOICE, TRUE_FALSE), ' +
      'поріг складання у відсотках, ліміт часу, ліміт спроб і прапорець перемішування питань. ' +
      'Назва унікальна в автошколі без урахування регістру.',
  })
  @ApiCreatedResponse({ type: TestDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло запиту. Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({ description: 'Створювати тести може лише ADMIN.' })
  @ApiNotFoundResponse({
    description:
      'Курс не знайдено або він чужої автошколи. Також якщо автошколу видалено.',
  })
  @ApiConflictResponse({
    description:
      'Тест з такою назвою вже є. Тіло містить errors: [{ field: name, message }].',
  })
  create(@CurrentUser() user: User, @Body() body: CreateTestDto) {
    return this.testsService.create(user, body);
  }

  @Get('current')
  @Roles(...TEST_STUDENT_ROLES)
  @ApiOperation({
    summary: 'Опубліковані тести курсу поточної групи студента',
    description:
      'STUDENT отримує тести курсу групи, у якій у нього Enrollment.status = ACTIVE. ' +
      'Курс має бути ACTIVE і PUBLISHED, інакше 403. Студент без такої групи отримує 404. ' +
      'У списку лише тести зі збереженим publicationStatus PUBLISHED цієї автошколи. ' +
      'Чернетки і тести інших організацій не повертаються. ' +
      'Кожен елемент містить актуальний publicationStatus і кількість питань, без тексту питань і без isCorrect.',
  })
  @ApiOkResponse({ type: StudentTestListDto })
  @ApiForbiddenResponse({
    description:
      'Ендпоінт лише для STUDENT. Також 403, якщо курс групи ще не опубліковано або його архівовано.',
  })
  @ApiNotFoundResponse({
    description:
      'У студента немає групи з призначеним курсом, або автошколу видалено.',
  })
  listCurrent(@CurrentUser() user: User) {
    return this.testsService.listCurrent(user);
  }

  @Get(':testId/content')
  @Roles(...TEST_STUDENT_ROLES)
  @ApiOperation({
    summary: 'Опублікований тест для проходження студентом',
    description:
      'STUDENT бачить тест лише якщо він його автошколи, publicationStatus = PUBLISHED, ' +
      'а курс тесту ACTIVE, PUBLISHED і призначений групі з активним зарахуванням цього студента. ' +
      'Тест іншої автошколи або неіснуючий — 404. ' +
      'Тест своєї автошколи, курс якого студенту не призначено, — 403. ' +
      'Призначений, але не опублікований тест або курс — 403, без питань. ' +
      'Відповідь містить актуальний publicationStatus, питання і варіанти. ' +
      'Поля isCorrect немає: правильні відповіді не віддаються до завершення спроби.',
  })
  @ApiParam(testIdParam)
  @ApiOkResponse({ type: StudentTestDetailDto })
  @ApiBadRequestResponse({ description: 'testId не UUID.' })
  @ApiForbiddenResponse({
    description:
      'Ендпоінт лише для STUDENT. 403, якщо тест або його курс не опубліковано, курс архівовано, або студентові не дозволено проходження.',
  })
  @ApiNotFoundResponse({
    description:
      'Тест не знайдено, він чужої автошколи, або автошколу видалено.',
  })
  getContent(
    @CurrentUser() user: User,
    @Param('testId', uuidPipe) testId: string,
  ) {
    return this.testsService.getContent(user, testId);
  }

  @Post(':testId/attempts')
  @Roles(...TEST_STUDENT_ROLES)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Почати спробу проходження тесту',
    description:
      'STUDENT створює окремий запис спроби для опублікованого тесту свого курсу. ' +
      'Зберігаються студент, тест, час старту за годинником сервера і статус IN_PROGRESS. ' +
      'Якщо в тесті є ліміт, сервер записує expiresAt = startedAt + timeLimitMinutes. ' +
      'Питання копіюються в спробу. Якщо тест їх перемішує, порядок фіксується тут і далі не змінюється. ' +
      'У відповіді немає isCorrect. ' +
      'Повторний старт, поки попередня спроба ще IN_PROGRESS і час не вийшов, повертає 409 і id тієї спроби. ' +
      'Прострочена відкрита спроба закривається як EXPIRED і вже рахується витраченою. ' +
      'Нова спроба недоступна, якщо тест уже PASSED або витрачено maxAttempts. null у maxAttempts ліміту кількості не ставить. ' +
      'Тест іншої автошколи або неіснуючий — 404. Курс не призначено, не опубліковано або архівовано — 403. ' +
      'Неопублікований тест — 403.',
  })
  @ApiParam(testIdParam)
  @ApiCreatedResponse({ type: AttemptDetailDto })
  @ApiBadRequestResponse({
    description:
      'testId не UUID або в тесті немає питань. Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description:
      'Ендпоінт лише для STUDENT. 403, якщо тест або курс не опубліковано, курс архівовано, або студентові не призначено цей курс.',
  })
  @ApiNotFoundResponse({
    description:
      'Тест не знайдено, він чужої автошколи, або автошколу видалено.',
  })
  @ApiConflictResponse({
    type: AttemptConflictDto,
    description:
      'Нову спробу не створено. reason пояснює причину: IN_PROGRESS, ALREADY_PASSED або ATTEMPTS_EXHAUSTED.',
  })
  startAttempt(
    @CurrentUser() user: User,
    @Param('testId', uuidPipe) testId: string,
  ) {
    return this.attemptsService.start(user, testId);
  }

  @Get(':testId/attempts/:attemptId')
  @Roles(...TEST_STUDENT_ROLES)
  @ApiOperation({
    summary: 'Питання і варіанти поточної спроби',
    description:
      'STUDENT отримує лише свою спробу цього тесту. ' +
      'Поки статус IN_PROGRESS, у варіантах немає isCorrect. ' +
      'expiresAt — дедлайн сервера. Якщо він уже настав, спроба закривається як EXPIRED, ' +
      'правильні відповіді при цьому не відкриваються. ' +
      'Після перевірки (PASSED або FAILED) відповідь містить isCorrect і selected. ' +
      'Чужа, чужого тесту або неіснуюча спроба — 404. ' +
      'Поки спроба триває, неопублікований тест або курс і втрачене зарахування дають 403.',
  })
  @ApiParam(testIdParam)
  @ApiParam(attemptIdParam)
  @ApiOkResponse({ type: AttemptDetailDto })
  @ApiBadRequestResponse({ description: 'testId або attemptId не UUID.' })
  @ApiForbiddenResponse({
    description:
      'Ендпоінт лише для STUDENT. 403, якщо триваюча спроба більше недоступна: тест або курс знято з публікації, курс архівовано, або зарахування не активне.',
  })
  @ApiNotFoundResponse({
    description:
      'Спроба не знайдена, вона чужа, від іншого тесту, або автошколу видалено.',
  })
  getAttempt(
    @CurrentUser() user: User,
    @Param('testId', uuidPipe) testId: string,
    @Param('attemptId', uuidPipe) attemptId: string,
  ) {
    return this.attemptsService.get(user, testId, attemptId);
  }

  @Post(':testId/attempts/:attemptId/submit')
  @Roles(...TEST_STUDENT_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Відправити відповіді спроби на перевірку',
    description:
      'Сервер сам звіряє відповіді зі знімком спроби і ставить PASSED або FAILED за passingScore. ' +
      'Пропущене питання вважається неправильним. ' +
      'Сервер порівнює відсоток із passingScore спроби: бал не нижчий за поріг дає PASSED, інакше FAILED. ' +
      'Актуальний результат курсу перезаписується і вказує на цього студента, цей тест і цю спробу. Другий рядок результату не створюється. ' +
      'Повторний submit тієї самої спроби повертає вже збережений результат і не додає відповіді. ' +
      'Якщо expiresAt вже настав, відповіді цього запиту не зберігаються, спроба стає EXPIRED, а результат курсу не змінюється. ' +
      'Час перевіряється лише на сервері. ' +
      'Після PASSED або FAILED у відповіді з’являються isCorrect і selected. Після EXPIRED правильні відповіді не відкриваються. ' +
      'Чужа спроба — 404.',
  })
  @ApiParam(testIdParam)
  @ApiParam(attemptIdParam)
  @ApiOkResponse({ type: AttemptDetailDto })
  @ApiBadRequestResponse({
    description:
      'id не UUID або відповіді не належать цій спробі. Для SINGLE_CHOICE і TRUE_FALSE можна обрати лише один варіант. ' +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description:
      'Ендпоінт лише для STUDENT. 403, якщо на момент вчасної здачі тест або курс уже недоступні.',
  })
  @ApiNotFoundResponse({
    description:
      'Спроба не знайдена, вона чужа, від іншого тесту, або автошколу видалено.',
  })
  submitAttempt(
    @CurrentUser() user: User,
    @Param('testId', uuidPipe) testId: string,
    @Param('attemptId', uuidPipe) attemptId: string,
    @Body() body: SubmitAttemptDto,
  ) {
    return this.attemptsService.submit(user, testId, attemptId, body);
  }

  @Get(':testId/result')
  @Roles(...TEST_STUDENT_ROLES)
  @ApiOperation({
    summary: 'Результат студента і доступність наступної спроби',
    description:
      'STUDENT бачить свій результат цього тесту: останній перевірений бал, статус PASSED або FAILED і поріг, з яким його порівнювали. ' +
      'Поки не було перевірки, result = null. ' +
      'attemptsUsed рахує витрачені спроби (PASSED, FAILED, EXPIRED). ' +
      'nextAttemptAvailable і unavailableReason кажуть, чи можна почати наступну. ' +
      'Після PASSED або після вичерпання maxAttempts нова спроба недоступна. ' +
      'Правильні відповіді цей запит не повертає. Їх видно в уже перевіреній спробі. ' +
      'Якщо спроб ще не було, доступ той самий, що й для старту: чужий тест — 404, не призначений або не опублікований курс чи тест — 403. ' +
      'Уже збережений результат своєї автошколи лишається видимим.',
  })
  @ApiParam(testIdParam)
  @ApiOkResponse({ type: TestOutcomeDto })
  @ApiBadRequestResponse({ description: 'testId не UUID.' })
  @ApiForbiddenResponse({
    description:
      'Ендпоінт лише для STUDENT. 403, якщо спроб ще немає, а тест або курс зараз недоступні.',
  })
  @ApiNotFoundResponse({
    description:
      'Тест не знайдено, він чужої автошколи, або автошколу видалено.',
  })
  getOwnResult(
    @CurrentUser() user: User,
    @Param('testId', uuidPipe) testId: string,
  ) {
    return this.attemptsService.getOwnResult(user, testId);
  }

  @Get(':testId/results')
  @Roles(...TEST_RESULT_STAFF_ROLES)
  @ApiOperation({
    summary: 'Результати тесту для викладача і адміністратора',
    description:
      'ADMIN бачить студентів своєї автошколи з зарахуванням ACTIVE або COMPLETED на курс цього тесту, у яких уже є спроба. ' +
      'TEACHER бачить лише студентів групи, яку він веде. ' +
      'Кожен рядок містить бал, passed/failed, витрачені спроби і чи студентові доступна наступна. ' +
      'Студенти і тести інших автошкіл не повертаються. Питання і isCorrect не входять.',
  })
  @ApiParam(testIdParam)
  @ApiOkResponse({ type: StaffTestResultListDto })
  @ApiBadRequestResponse({ description: 'testId не UUID.' })
  @ApiForbiddenResponse({
    description: 'Список результатів доступний ADMIN і TEACHER.',
  })
  @ApiNotFoundResponse({
    description:
      'Тест не знайдено, він чужої автошколи, або автошколу видалено.',
  })
  listResults(
    @CurrentUser() user: User,
    @Param('testId', uuidPipe) testId: string,
  ) {
    return this.attemptsService.listResults(user, testId);
  }

  @Get(':testId/results/:studentId')
  @Roles(...TEST_RESULT_STAFF_ROLES)
  @ApiOperation({
    summary: 'Результат одного студента по тесту',
    description:
      'ADMIN читає результат студента своєї автошколи, якщо той зарахований на курс тесту. ' +
      'TEACHER — лише якщо студент у його групі на цьому курсі. Інакше 403, коли студент навчається в чужій групі, або 404, коли такого зарахування немає. ' +
      'Студент іншої автошколи, видалений користувач і не-студент — 404. ' +
      'Відповідь містить актуальний бал, статуси спроб і доступність наступної спроби.',
  })
  @ApiParam(testIdParam)
  @ApiParam(resultStudentIdParam)
  @ApiOkResponse({ type: StaffTestResultDto })
  @ApiBadRequestResponse({ description: 'testId або studentId не UUID.' })
  @ApiForbiddenResponse({
    description:
      'Ендпоінт доступний ADMIN і TEACHER. TEACHER отримує 403, якщо студент на цьому курсі в чужій групі.',
  })
  @ApiNotFoundResponse({
    description:
      'Тест або студента не знайдено в цій автошколі, студент не зарахований на курс, або автошколу видалено.',
  })
  getStudentResult(
    @CurrentUser() user: User,
    @Param('testId', uuidPipe) testId: string,
    @Param('studentId', uuidPipe) studentId: string,
  ) {
    return this.attemptsService.getStudentResult(user, testId, studentId);
  }

  @Get(':testId')
  @Roles(...TEST_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Тест із питаннями і варіантами відповідей',
    description:
      'ADMIN отримує тест своєї автошколи разом із питаннями і варіантами за position. ' +
      'isCorrect показує правильну відповідь відповідно до формату. ' +
      'Студент цей запит не викликає: йому доступні GET /tests/current і GET /tests/{testId}/content, без isCorrect. ' +
      'Тест іншої автошколи повертає 404. Порожній тест має questions: [].',
  })
  @ApiParam(testIdParam)
  @ApiOkResponse({ type: TestDetailDto })
  @ApiForbiddenResponse({ description: 'Тест бачить лише ADMIN.' })
  @ApiNotFoundResponse({
    description:
      'Тест не знайдено, він чужої автошколи, або автошколу видалено.',
  })
  get(@CurrentUser() user: User, @Param('testId', uuidPipe) testId: string) {
    return this.testsService.get(user, testId);
  }

  @Patch(':testId')
  @Roles(...TEST_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Редагувати назву і параметри тесту',
    description:
      'ADMIN змінює name, description, courseId, format, passingScore, timeLimitMinutes, maxAttempts або shuffleQuestions. ' +
      'null у description очищає опис, null у timeLimitMinutes знімає ліміт часу. ' +
      'Зміна format у чернетці відхиляється, якщо в питанні вже кілька правильних відповідей, а новий формат дозволяє лише одну. ' +
      'В опублікованого тесту новий format має одразу проходити перевірку структури. ' +
      'Опублікований тест не можна перенести на архівований курс. Тест іншої автошколи повертає 404.',
  })
  @ApiParam(testIdParam)
  @ApiOkResponse({ type: TestDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло, порожнє тіло, id не UUID або формат не збігається з відповідями. ' +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({ description: 'Редагувати тести може лише ADMIN.' })
  @ApiNotFoundResponse({
    description:
      'Тест або курс не знайдено, або вони чужої автошколи. Також якщо автошколу видалено.',
  })
  @ApiConflictResponse({
    description:
      'Тест з такою назвою вже є, або опублікований тест переносять на архівований курс.',
  })
  update(
    @CurrentUser() user: User,
    @Param('testId', uuidPipe) testId: string,
    @Body() body: UpdateTestDto,
  ) {
    return this.testsService.update(user, testId, body);
  }

  @Patch(':testId/publication')
  @Roles(...TEST_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Опублікувати або зняти з публікації теоретичний тест',
    description:
      'ADMIN зберігає publicationStatus тесту своєї автошколи. ' +
      'PUBLISHED перевіряє структуру: є хоча б одне питання, і кожне відповідає format. ' +
      'SINGLE_CHOICE — щонайменше два варіанти і рівно одна правильна відповідь. ' +
      'MULTIPLE_CHOICE — щонайменше два варіанти, хоча б одна правильна і хоча б одна неправильна. ' +
      'TRUE_FALSE — рівно два варіанти і рівно одна правильна відповідь. ' +
      'Курс тесту має бути ACTIVE. Опублікований тест стає доступний студенту з активним зарахуванням ' +
      'на цей курс, якщо сам курс теж ACTIVE і PUBLISHED. ' +
      'DRAFT знімає публікацію без перевірки структури, і студенти знову не бачать тест. ' +
      'Повтор того самого статусу нічого не записує. Відповідь містить збережений publicationStatus.',
  })
  @ApiParam(testIdParam)
  @ApiOkResponse({ type: TestDto })
  @ApiBadRequestResponse({
    description:
      'id не UUID, publicationStatus не DRAFT і не PUBLISHED, або структура тесту не готова до публікації. ' +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description: 'Змінювати публікацію тесту може лише ADMIN.',
  })
  @ApiNotFoundResponse({
    description:
      'Тест не знайдено, він чужої автошколи, або автошколу видалено.',
  })
  @ApiConflictResponse({
    description:
      'Архівований курс не можна використати для опублікованого тесту.',
  })
  changePublication(
    @CurrentUser() user: User,
    @Param('testId', uuidPipe) testId: string,
    @Body() body: UpdateTestPublicationDto,
  ) {
    return this.testsService.changePublication(user, testId, body);
  }

  @Post(':testId/questions')
  @Roles(...TEST_MANAGE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Додати питання до тесту',
    description:
      'Питання прив’язується до тесту з адреси. Без position стає останнім. ' +
      'У тілі можна одразу передати options: текст і isCorrect. Порядок масиву стає позицією варіантів. ' +
      'Для SINGLE_CHOICE і TRUE_FALSE не можна передати дві правильні відповіді. ' +
      'В опублікований тест питання додається лише разом із варіантами, які вже відповідають формату.',
  })
  @ApiParam(testIdParam)
  @ApiCreatedResponse({ type: QuestionDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло, position поза діапазоном або відповіді не відповідають формату. ' +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({ description: 'Додавати питання може лише ADMIN.' })
  @ApiNotFoundResponse({
    description: 'Тест не знайдено або він належить іншій автошколі.',
  })
  createQuestion(
    @CurrentUser() user: User,
    @Param('testId', uuidPipe) testId: string,
    @Body() body: CreateQuestionDto,
  ) {
    return this.testsService.createQuestion(user, testId, body);
  }

  @Patch(':testId/questions/:questionId')
  @Roles(...TEST_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Редагувати питання тесту',
    description:
      'ADMIN змінює текст або position питання свого тесту. ' +
      'Питання іншого тесту або іншої автошколи повертає 404.',
  })
  @ApiParam(testIdParam)
  @ApiParam(questionIdParam)
  @ApiOkResponse({ type: QuestionDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло, порожнє тіло або id не UUID. Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({ description: 'Редагувати питання може лише ADMIN.' })
  @ApiNotFoundResponse({
    description: 'Тест або питання не знайдено в цій автошколі.',
  })
  updateQuestion(
    @CurrentUser() user: User,
    @Param('testId', uuidPipe) testId: string,
    @Param('questionId', uuidPipe) questionId: string,
    @Body() body: UpdateQuestionDto,
  ) {
    return this.testsService.updateQuestion(user, testId, questionId, body);
  }

  @Delete(':testId/questions/:questionId')
  @Roles(...TEST_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Видалити питання тесту',
    description:
      'Питання і його варіанти видаляються. Позиції наступних питань зсуваються. ' +
      'Єдине питання опублікованого тесту видалити не можна: спочатку зніміть публікацію або додайте інше. ' +
      'Відповідь — питання, яке видалено.',
  })
  @ApiParam(testIdParam)
  @ApiParam(questionIdParam)
  @ApiOkResponse({ type: QuestionDto })
  @ApiBadRequestResponse({
    description:
      'id не UUID або це останнє питання опублікованого тесту. Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({ description: 'Видаляти питання може лише ADMIN.' })
  @ApiNotFoundResponse({
    description: 'Тест або питання не знайдено в цій автошколі.',
  })
  deleteQuestion(
    @CurrentUser() user: User,
    @Param('testId', uuidPipe) testId: string,
    @Param('questionId', uuidPipe) questionId: string,
  ) {
    return this.testsService.deleteQuestion(user, testId, questionId);
  }

  @Post(':testId/questions/:questionId/options')
  @Roles(...TEST_MANAGE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Додати варіант відповіді',
    description:
      'Варіант зберігає text і isCorrect. Для SINGLE_CHOICE і TRUE_FALSE isCorrect=true ' +
      'знімає правильну відповідь з інших варіантів цього питання, тож правильна лишається одна. ' +
      'В опублікованому тесті після додавання питання має лишатися коректним для свого формату.',
  })
  @ApiParam(testIdParam)
  @ApiParam(questionIdParam)
  @ApiCreatedResponse({ type: AnswerOptionDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло або після додавання питання перестає відповідати формату опублікованого тесту. ' +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description: 'Додавати варіанти може лише ADMIN.',
  })
  @ApiNotFoundResponse({
    description: 'Тест або питання не знайдено в цій автошколі.',
  })
  createOption(
    @CurrentUser() user: User,
    @Param('testId', uuidPipe) testId: string,
    @Param('questionId', uuidPipe) questionId: string,
    @Body() body: CreateAnswerOptionDto,
  ) {
    return this.testsService.createOption(user, testId, questionId, body);
  }

  @Patch(':testId/questions/:questionId/options/:optionId')
  @Roles(...TEST_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Редагувати варіант відповіді',
    description:
      'ADMIN змінює text, isCorrect або position. ' +
      'Для SINGLE_CHOICE і TRUE_FALSE isCorrect=true зберігає рівно одну правильну відповідь у питанні. ' +
      'Опублікований тест не можна залишити з відповідями, які не відповідають формату.',
  })
  @ApiParam(testIdParam)
  @ApiParam(questionIdParam)
  @ApiParam(optionIdParam)
  @ApiOkResponse({ type: AnswerOptionDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло, порожнє тіло або зміна ламає формат опублікованого тесту. ' +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description: 'Редагувати варіанти може лише ADMIN.',
  })
  @ApiNotFoundResponse({
    description: 'Тест, питання або варіант не знайдено в цій автошколі.',
  })
  updateOption(
    @CurrentUser() user: User,
    @Param('testId', uuidPipe) testId: string,
    @Param('questionId', uuidPipe) questionId: string,
    @Param('optionId', uuidPipe) optionId: string,
    @Body() body: UpdateAnswerOptionDto,
  ) {
    return this.testsService.updateOption(
      user,
      testId,
      questionId,
      optionId,
      body,
    );
  }

  @Delete(':testId/questions/:questionId/options/:optionId')
  @Roles(...TEST_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Видалити варіант відповіді',
    description:
      'Варіант видаляється, позиції наступних зсуваються. ' +
      'З опублікованого тесту не можна прибрати варіант, якщо питання перестане відповідати формату. ' +
      'Відповідь — варіант, який видалено.',
  })
  @ApiParam(testIdParam)
  @ApiParam(questionIdParam)
  @ApiParam(optionIdParam)
  @ApiOkResponse({ type: AnswerOptionDto })
  @ApiBadRequestResponse({
    description:
      'id не UUID або після видалення питання опублікованого тесту стає некоректним. ' +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description: 'Видаляти варіанти може лише ADMIN.',
  })
  @ApiNotFoundResponse({
    description: 'Тест, питання або варіант не знайдено в цій автошколі.',
  })
  deleteOption(
    @CurrentUser() user: User,
    @Param('testId', uuidPipe) testId: string,
    @Param('questionId', uuidPipe) questionId: string,
    @Param('optionId', uuidPipe) optionId: string,
  ) {
    return this.testsService.deleteOption(user, testId, questionId, optionId);
  }
}
