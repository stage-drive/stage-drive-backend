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
  Query,
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
  AttemptClosedDto,
  AttemptConflictDto,
  OwnTestAttemptsDto,
  SaveAttemptAnswersDto,
  StaffAllTestAttemptsQueryDto,
  StaffTestAttemptListDto,
  StaffTestAttemptsQueryDto,
  StaffTestResultDto,
  StaffTestResultListDto,
  SubmitAttemptDto,
  TestAttemptDto,
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
  TestListQueryDto,
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
      'ADMIN бачить усі тести організації. TEACHER — тести курсів, призначених групам, які він веде. ' +
      'Фільтри: courseId (курс), lessonId (урок програми курсу, CourseLesson), publicationStatus (DRAFT, PUBLISHED або ARCHIVED). ' +
      'Для викладача курс (або курс уроку) має бути курсом його групи, інакше 403. ' +
      'Чужий або неіснуючий курс чи урок — 404. Без publicationStatus повертаються всі тести, включно з ARCHIVED. ' +
      'У відповіді назва, урок, курс, формат, поріг, ліміт часу, ліміт спроб, ' +
      'перемішування, статус публікації і кількість питань. INSTRUCTOR доступу не має.',
  })
  @ApiOkResponse({ type: TestListDto })
  @ApiBadRequestResponse({
    description:
      'courseId або lessonId не UUID, або publicationStatus не DRAFT, PUBLISHED, ARCHIVED. Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description:
      'Список тестів доступний ADMIN і TEACHER. Викладач чужого курсу отримує 403.',
  })
  @ApiNotFoundResponse({
    description:
      'Автошколу не знайдено або її видалено. Також якщо courseId або lessonId не знайдено в цій автошколі.',
  })
  list(@CurrentUser() user: User, @Query() query: TestListQueryDto) {
    return this.testsService.list(user, query);
  }

  @Post()
  @Roles(...TEST_MANAGE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Створити теоретичний тест уроку',
    description:
      'ADMIN або TEACHER групи з курсом цього уроку створює тест у своїй організації. organizationId береться з access token і не приймається в тілі. ' +
      'Тест прив’язується до уроку програми курсу (lessonId = CourseLesson): курс береться з уроку, а не з тіла. ' +
      'У уроку може бути лише один не архівний тест (409), maxAttempts тесту уроку завжди 3. ' +
      'Новий тест завжди DRAFT, опублікувати його можна лише через PATCH /tests/{testId}/publication після перевірки. ' +
      'Зберігаються назва, опис, поріг складання у відсотках, ліміт часу (timeLimitMinutes, необов’язково) і прапорець перемішування питань. ' +
      'Тип кожного питання (SINGLE_CHOICE, MULTIPLE_CHOICE, TRUE_FALSE) задається в самому питанні. ' +
      'Застарілий формат: лише courseId без lessonId створює тест курсу без уроку, який не публікується, доки його не прив’язано до уроку. ' +
      'Назва унікальна в автошколі без урахування регістру (архівні тести не рахуються). INSTRUCTOR доступу не має.',
  })
  @ApiCreatedResponse({ type: TestDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло запиту. Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description:
      'Створювати тести може ADMIN або TEACHER групи, якій призначено курс.',
  })
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

  @Get('attempts')
  @Roles(...TEST_RESULT_STAFF_ROLES)
  @ApiOperation({
    summary: 'Спроби студентів по всіх тестах для викладача і адміністратора',
    description:
      'ADMIN бачить спроби студентів своєї автошколи. TEACHER — лише студентів своїх груп на курсах цих груп. ' +
      'Фільтри: groupId (TEACHER може вказати лише свою групу, інакше 403), studentId, testId, ' +
      'status (IN_PROGRESS, COMPLETED, EXPIRED) і result (PASSED, FAILED). ' +
      'Кожен рядок: студент, група, тест, номер спроби в циклі, статус, результат, scorePercent, correctCount і час. ' +
      'Питання і isCorrect не входять. Від новішої, зі сторінками page і limit. INSTRUCTOR доступу не має. ' +
      'Прострочені відкриті спроби перед читанням закриваються як EXPIRED.',
  })
  @ApiOkResponse({ type: StaffTestAttemptListDto })
  @ApiBadRequestResponse({
    description:
      'Фільтр не UUID або не з дозволених значень, page чи limit поза межами. Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description:
      'Ендпоінт для ADMIN і TEACHER. TEACHER отримує 403, якщо вказав чужу групу або тест курсу, якого немає в його групах.',
  })
  @ApiNotFoundResponse({
    description:
      'Група або тест не знайдені в цій автошколі, або автошколу видалено.',
  })
  listAttempts(
    @CurrentUser() user: User,
    @Query() query: StaffAllTestAttemptsQueryDto,
  ) {
    return this.attemptsService.listAttempts(user, query);
  }

  @Get('attempts/:attemptId')
  @Roles(...TEST_STUDENT_ROLES)
  @ApiOperation({
    summary: 'Спроба студента: питання, варіанти і збережені відповіді',
    description:
      'STUDENT отримує лише свою спробу і за цим запитом продовжує її після перезавантаження: у відповіді питання, варіанти і answers, що вже збережені. ' +
      'Поки статус IN_PROGRESS, у варіантах немає isCorrect, а бали й result порожні. ' +
      'expiresAt — дедлайн сервера (startedAt + timeLimitMinutes). Якщо він уже настав, спроба тут же закривається як EXPIRED, правильні відповіді не відкриваються. ' +
      'Після перевірки (status = COMPLETED) з’являються result, scorePercent, correctCount, isCorrect і selected. ' +
      'Чужа або неіснуюча спроба — 404. Поки спроба триває, неопублікований тест або курс і втрачене зарахування дають 403.',
  })
  @ApiParam(attemptIdParam)
  @ApiOkResponse({ type: TestAttemptDto })
  @ApiBadRequestResponse({ description: 'attemptId не UUID.' })
  @ApiForbiddenResponse({
    description:
      'Ендпоінт лише для STUDENT. 403, якщо триваюча спроба більше недоступна: тест або курс знято з публікації, курс архівовано, або зарахування не активне.',
  })
  @ApiNotFoundResponse({
    description: 'Спроба не знайдена, вона чужа, або автошколу видалено.',
  })
  getAttemptById(
    @CurrentUser() user: User,
    @Param('attemptId', uuidPipe) attemptId: string,
  ) {
    return this.attemptsService.get(user, attemptId);
  }

  @Patch('attempts/:attemptId/answers')
  @Roles(...TEST_STUDENT_ROLES)
  @ApiOperation({
    summary: 'Зберегти проміжні відповіді спроби',
    description:
      'STUDENT зберігає вибір у відкритій спробі, щоб не втратити його при перезавантаженні. ' +
      'Для кожного питання зі списку збережений вибір замінюється, порожній optionIds його очищає, інші питання лишаються як були. ' +
      'Правильність не перевіряється і не повертається: isCorrect у відповіді немає. ' +
      'Для SINGLE_CHOICE і TRUE_FALSE можна обрати лише один варіант. ' +
      'Спроба, яка вже завершена або в якої вийшов час, відповідей не приймає (409). ' +
      'Час перевіряє лише сервер за startedAt і timeLimitMinutes.',
  })
  @ApiParam(attemptIdParam)
  @ApiOkResponse({ type: TestAttemptDto })
  @ApiBadRequestResponse({
    description:
      'attemptId не UUID, відповіді не належать цій спробі, дубль питання або кілька варіантів там, де дозволено один. ' +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description:
      'Ендпоінт лише для STUDENT. 403, якщо тест або курс уже недоступні для проходження.',
  })
  @ApiNotFoundResponse({
    description: 'Спроба не знайдена, вона чужа, або автошколу видалено.',
  })
  @ApiConflictResponse({
    type: AttemptClosedDto,
    description:
      'Спроба вже не приймає відповіді: status = COMPLETED або EXPIRED. Якщо дедлайн минув саме зараз, спроба стає EXPIRED.',
  })
  saveAnswers(
    @CurrentUser() user: User,
    @Param('attemptId', uuidPipe) attemptId: string,
    @Body() body: SaveAttemptAnswersDto,
  ) {
    return this.attemptsService.saveAnswers(user, attemptId, body);
  }

  @Post('attempts/:attemptId/submit')
  @Roles(...TEST_STUDENT_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Здати спробу на перевірку',
    description:
      'Сервер сам звіряє відповіді зі знімком спроби і ставить result = PASSED або FAILED за passingScore: бал не нижчий за поріг дає PASSED. ' +
      'Питання вважається правильним, лише коли обрано точно набір правильних варіантів, пропущене — неправильне. ' +
      'Клієнт не передає ні бали, ні result, ні passed: такі поля в тілі відхиляються. ' +
      'answers у тілі замінюють усі збережені відповіді; без answers перевіряється те, що збережено через PATCH answers. ' +
      'Відповідь: status = COMPLETED, result, scorePercent, earnedPoints, maxPoints, correctCount, totalQuestions, attemptNumber, attemptsLeft і правильні відповіді (isCorrect, selected). ' +
      'Тест уроку: PASSED відкриває наступний урок. FAILED не закриває спробу «урок пройдено»: можна починати наступну, поки attemptsLeft > 0. ' +
      'Коли всі 3 спроби витрачено без PASSED, у відповіді message «Пройдіть урок ще раз.». ' +
      'Повторний submit тієї самої спроби повертає вже збережений результат і нічого не пише. ' +
      'Якщо expiresAt уже настав, відповіді не зберігаються, а спроба стає EXPIRED без оцінки. Чужа спроба — 404.',
  })
  @ApiParam(attemptIdParam)
  @ApiOkResponse({ type: TestAttemptDto })
  @ApiBadRequestResponse({
    description:
      'attemptId не UUID, відповіді не належать цій спробі, дубль питання, кілька варіантів там, де дозволено один, або зайві поля в тілі. ' +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description:
      'Ендпоінт лише для STUDENT. 403, якщо на момент вчасної здачі тест або курс уже недоступні.',
  })
  @ApiNotFoundResponse({
    description: 'Спроба не знайдена, вона чужа, або автошколу видалено.',
  })
  submitAttemptById(
    @CurrentUser() user: User,
    @Param('attemptId', uuidPipe) attemptId: string,
    @Body() body: SubmitAttemptDto,
  ) {
    return this.attemptsService.submit(user, attemptId, body);
  }

  @Post('attempts/:attemptId/expire')
  @Roles(...TEST_STUDENT_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Закрити спробу, якщо вийшов час',
    description:
      'Клієнт викликає це, коли його таймер дійшов до нуля. Рішення за сервером: спроба стає EXPIRED лише коли expiresAt справді минув, ' +
      'без оцінки і без правильних відповідей, а витрачений слот лишається витраченим. ' +
      'Якщо дедлайн ще не настав (годинник клієнта поспішає) або ліміту часу немає, спроба повертається без змін зі status = IN_PROGRESS. ' +
      'Уже закрита спроба повертається як є. Сервер і сам закриває прострочені спроби при будь-якому зверненні до них.',
  })
  @ApiParam(attemptIdParam)
  @ApiOkResponse({ type: TestAttemptDto })
  @ApiBadRequestResponse({ description: 'attemptId не UUID.' })
  @ApiForbiddenResponse({ description: 'Ендпоінт лише для STUDENT.' })
  @ApiNotFoundResponse({
    description: 'Спроба не знайдена, вона чужа, або автошколу видалено.',
  })
  expireAttempt(
    @CurrentUser() user: User,
    @Param('attemptId', uuidPipe) attemptId: string,
  ) {
    return this.attemptsService.expire(user, attemptId);
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
      'STUDENT створює нову спробу (status = IN_PROGRESS) опублікованого тесту свого уроку. ' +
      'Тест доступний лише через ланцюжок студент → група → курс → урок → опублікований тест своєї автошколи. ' +
      'Переглядати матеріали уроку не обов’язково: тест відкривається, коли відкритий сам урок, тобто попередній урок складено. ' +
      'У відповіді питання з типом (type) і варіантами без isCorrect, attemptNumber, attemptsUsed, attemptsLeft і expiresAt. ' +
      'Якщо в тесті є ліміт, сервер записує expiresAt = startedAt + timeLimitMinutes, і правду про час знає лише він. ' +
      'Питання копіюються в спробу. Якщо тест їх перемішує, порядок фіксується тут і далі не змінюється. ' +
      'Повторний старт, поки попередня спроба ще IN_PROGRESS і час не вийшов, повертає 409 з reason = IN_PROGRESS і attemptId тієї спроби. ' +
      'Прострочена відкрита спроба закривається як EXPIRED і вже рахується витраченою. ' +
      'Тест уроку дає 3 спроби на цикл. Після PASSED або після 3 витрачених спроб нова спроба — 409 (ALREADY_PASSED, ATTEMPTS_EXHAUSTED з «Пройдіть урок ще раз.»). ' +
      'Нові 3 спроби відкриваються, коли студент пройде урок ще раз (POST /courses/{courseId}/lessons/{lessonId}/complete); історія старих спроб лишається. ' +
      'Тест іншої автошколи або неіснуючий — 404. Курс не призначено, не опубліковано або архівовано, урок закритий — 403. ' +
      'Неопублікований або архівований тест — 403. INSTRUCTOR доступу не має.',
  })
  @ApiParam(testIdParam)
  @ApiCreatedResponse({ type: TestAttemptDto })
  @ApiBadRequestResponse({
    description:
      'testId не UUID або в тесті немає питань. Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description:
      'Ендпоінт лише для STUDENT. 403, якщо тест або курс не опубліковано, курс архівовано, урок ще закритий попереднім, або студентові не призначено цей курс.',
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

  @Get(':testId/attempts')
  @Roles(...TEST_RESULT_STAFF_ROLES)
  @ApiOperation({
    summary: 'Спроби студентів цього тесту',
    description:
      'ADMIN бачить спроби студентів своєї автошколи. TEACHER — лише студентів своїх груп на курсі цього тесту; ' +
      'якщо курс не призначено жодній його групі, 403. ' +
      'Фільтри groupId, studentId, status (IN_PROGRESS, COMPLETED, EXPIRED) і result (PASSED, FAILED). Від новішої, зі сторінками page і limit. ' +
      'Кожен рядок: студент, група, номер спроби в циклі, статус, результат, scorePercent, correctCount, totalQuestions і час. ' +
      'Питання і isCorrect не входять. INSTRUCTOR доступу не має.',
  })
  @ApiParam(testIdParam)
  @ApiOkResponse({ type: StaffTestAttemptListDto })
  @ApiBadRequestResponse({
    description:
      'testId або фільтр не UUID чи не з дозволених значень. Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description:
      'Ендпоінт для ADMIN і TEACHER. TEACHER отримує 403, якщо вказав чужу групу або курсу цього тесту немає в його групах.',
  })
  @ApiNotFoundResponse({
    description:
      'Тест або група не знайдені в цій автошколі, або автошколу видалено.',
  })
  listTestAttempts(
    @CurrentUser() user: User,
    @Param('testId', uuidPipe) testId: string,
    @Query() query: StaffTestAttemptsQueryDto,
  ) {
    return this.attemptsService.listForTest(user, testId, query);
  }

  @Get(':testId/attempts/me')
  @Roles(...TEST_STUDENT_ROLES)
  @ApiOperation({
    summary: 'Мої спроби цього тесту',
    description:
      'STUDENT бачить історію своїх спроб цього тесту за всі цикли (від новішої) і стан поточного циклу: ' +
      'passed, attemptsUsed, attemptsLeft, nextAttemptAvailable з unavailableReason та openAttemptId відкритої спроби. ' +
      'Питання і правильні відповіді сюди не входять: їх відкриває GET /tests/attempts/{attemptId} для перевіреної спроби. ' +
      'Якщо спроб ще не було, доступ той самий, що й для старту: чужий тест — 404, не призначений або не опублікований курс чи тест — 403. ' +
      'Уже збережена історія лишається видимою.',
  })
  @ApiParam(testIdParam)
  @ApiOkResponse({ type: OwnTestAttemptsDto })
  @ApiBadRequestResponse({ description: 'testId не UUID.' })
  @ApiForbiddenResponse({
    description:
      'Ендпоінт лише для STUDENT. 403, якщо спроб ще немає, а тест або курс зараз недоступні.',
  })
  @ApiNotFoundResponse({
    description:
      'Тест не знайдено, він чужої автошколи, або автошколу видалено.',
  })
  listOwnAttempts(
    @CurrentUser() user: User,
    @Param('testId', uuidPipe) testId: string,
  ) {
    return this.attemptsService.listOwn(user, testId);
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
      'ADMIN отримує будь-який тест своєї автошколи. TEACHER — тест курсу своєї групи. ' +
      'Відповідь містить питання і варіанти за position. ' +
      'isCorrect показує правильну відповідь відповідно до формату. ' +
      'Студент цей запит не викликає: йому доступні GET /tests/current і GET /tests/{testId}/content, без isCorrect. ' +
      'Тест іншої автошколи повертає 404. Тест своєї автошколи з чужого для викладача курсу — 403. ' +
      'Порожній тест має questions: [].',
  })
  @ApiParam(testIdParam)
  @ApiOkResponse({ type: TestDetailDto })
  @ApiForbiddenResponse({
    description:
      'Тест бачить ADMIN або TEACHER групи, якій призначено курс цього тесту.',
  })
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
      'ADMIN або TEACHER групи з курсом тесту змінює name, description, lessonId, passingScore, timeLimitMinutes, maxAttempts або shuffleQuestions. ' +
      'lessonId прив’язує чернетку до уроку курсу тесту (лише DRAFT, 409 якщо в уроку вже є не архівний тест). ' +
      'maxAttempts тесту уроку завжди 3. null у description очищає опис, null у timeLimitMinutes знімає ліміт часу. ' +
      'format — лише тип за замовчуванням для нових питань; тип кожного питання змінюється в самому питанні. ' +
      'Опублікований тест після зміни має одразу проходити перевірку публікації. Архівований тест не редагується (409). ' +
      'Тест іншої автошколи повертає 404.',
  })
  @ApiParam(testIdParam)
  @ApiOkResponse({ type: TestDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло, порожнє тіло, id не UUID або опублікований тест після зміни перестає відповідати вимогам публікації. ' +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description:
      'Редагувати тести може ADMIN або TEACHER групи, якій призначено курс.',
  })
  @ApiNotFoundResponse({
    description:
      'Тест, курс або урок не знайдено, або вони чужої автошколи. Також якщо автошколу видалено.',
  })
  @ApiConflictResponse({
    description:
      'Тест з такою назвою вже є, у уроку вже є не архівний тест, урок опублікованого тесту не змінюється, тест архівований або курс архівований.',
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
      'ADMIN або TEACHER групи з курсом тесту зберігає publicationStatus тесту своєї автошколи (DRAFT або PUBLISHED; архів — PATCH /tests/{testId}/archive). ' +
      'PUBLISHED можливий лише після перевірки UC-003: є назва, тест прив’язаний до уроку, поріг складання заданий, ' +
      'ліміт спроб більший за 0 (у тесту уроку їх 3), є хоча б одне питання, а в кожного питання є варіанти і правильні відповіді за його типом. ' +
      'SINGLE_CHOICE — щонайменше два варіанти і рівно одна правильна відповідь. ' +
      'MULTIPLE_CHOICE — щонайменше два варіанти, хоча б одна правильна і хоча б одна неправильна. ' +
      'TRUE_FALSE — рівно два варіанти і рівно одна правильна відповідь. ' +
      'Усі знайдені проблеми повертаються разом у errors[{ field, message }]. ' +
      'Курс тесту має бути ACTIVE. Опублікований тест стає доступний студенту з активним зарахуванням ' +
      'на цей курс, якщо сам курс теж ACTIVE і PUBLISHED. ' +
      'DRAFT знімає публікацію без перевірки структури, і студенти знову не бачать тест. ' +
      'Зняти опублікований тест опублікованого уроку не можна: спершу урок повертають у DRAFT. ' +
      'Повтор того самого статусу нічого не записує. Відповідь містить збережений publicationStatus.',
  })
  @ApiParam(testIdParam)
  @ApiOkResponse({ type: TestDto })
  @ApiBadRequestResponse({
    description:
      'id не UUID, publicationStatus не DRAFT і не PUBLISHED, або тест не проходить перевірку публікації (UC-003). ' +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description:
      'Змінювати публікацію тесту може ADMIN або TEACHER групи, якій призначено курс.',
  })
  @ApiNotFoundResponse({
    description:
      'Тест не знайдено, він чужої автошколи, або автошколу видалено.',
  })
  @ApiConflictResponse({
    description:
      'Архівований курс не можна використати для опублікованого тесту. Архівований тест не публікується. ' +
      'Опублікований тест опублікованого уроку не знімається з публікації.',
  })
  changePublication(
    @CurrentUser() user: User,
    @Param('testId', uuidPipe) testId: string,
    @Body() body: UpdateTestPublicationDto,
  ) {
    return this.testsService.changePublication(user, testId, body);
  }

  @Patch(':testId/archive')
  @Roles(...TEST_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Архівувати тест',
    description:
      'Переводить тест у ARCHIVED: студенти його більше не бачать і не можуть почати спробу, а в уроку з’являється місце для нового тесту. ' +
      'Історія спроб і результатів лишається, її бачать ADMIN і TEACHER. Відкриті спроби цього тесту закриваються як EXPIRED. ' +
      'Архівований тест не редагується і не публікується. Повторний виклик нічого не змінює. ' +
      'Опублікований тест опублікованого уроку не архівується, доки урок опублікований. ' +
      'ADMIN архівує будь-який тест своєї автошколи, TEACHER — тест курсу своєї групи.',
  })
  @ApiParam(testIdParam)
  @ApiOkResponse({ type: TestDto })
  @ApiBadRequestResponse({ description: 'testId не UUID.' })
  @ApiForbiddenResponse({
    description:
      'Архівувати може ADMIN або TEACHER групи, якій призначено курс тесту.',
  })
  @ApiNotFoundResponse({
    description:
      'Тест не знайдено, він чужої автошколи, або автошколу видалено.',
  })
  @ApiConflictResponse({
    description:
      'Опублікований тест опублікованого уроку не архівується, доки урок опублікований.',
  })
  archive(
    @CurrentUser() user: User,
    @Param('testId', uuidPipe) testId: string,
  ) {
    return this.testsService.archive(user, testId);
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
  @ApiForbiddenResponse({
    description:
      'Додавати питання може ADMIN або TEACHER групи, якій призначено курс.',
  })
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
  @ApiForbiddenResponse({
    description:
      'Редагувати питання може ADMIN або TEACHER групи, якій призначено курс.',
  })
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
  @ApiForbiddenResponse({
    description:
      'Видаляти питання може ADMIN або TEACHER групи, якій призначено курс.',
  })
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
    description:
      'Додавати варіанти може ADMIN або TEACHER групи, якій призначено курс.',
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
    description:
      'Редагувати варіанти може ADMIN або TEACHER групи, якій призначено курс.',
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
    description:
      'Видаляти варіанти може ADMIN або TEACHER групи, якій призначено курс.',
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
