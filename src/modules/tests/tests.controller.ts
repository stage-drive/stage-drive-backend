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
  AnswerOptionDto,
  CreateAnswerOptionDto,
  CreateQuestionDto,
  CreateTestDto,
  QuestionDto,
  TestDetailDto,
  TestDto,
  TestListDto,
  UpdateAnswerOptionDto,
  UpdateQuestionDto,
  UpdateTestDto,
  UpdateTestPublicationDto,
} from './tests.dto';
import { TEST_MANAGE_ROLES, TestsService } from './tests.service';

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

const uuidPipe = new ParseUUIDPipe({ version: '4' });

@ApiTags('tests')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@Controller('tests')
@UseGuards(AuthGuard, RolesGuard)
export class TestsController {
  constructor(private readonly testsService: TestsService) {}

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
      'поріг складання у відсотках, ліміт часу і прапорець перемішування питань. ' +
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

  @Get(':testId')
  @Roles(...TEST_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Тест із питаннями і варіантами відповідей',
    description:
      'ADMIN отримує тест своєї автошколи разом із питаннями і варіантами за position. ' +
      'isCorrect показує правильну відповідь відповідно до формату. ' +
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
      'ADMIN змінює name, description, courseId, format, passingScore, timeLimitMinutes або shuffleQuestions. ' +
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
      'PUBLISHED перевіряє структуру: є хоча б одне питання, і кожне відповідає format. ' +
      'SINGLE_CHOICE — щонайменше два варіанти і рівно одна правильна відповідь. ' +
      'MULTIPLE_CHOICE — щонайменше два варіанти, хоча б одна правильна і хоча б одна неправильна. ' +
      'TRUE_FALSE — рівно два варіанти і рівно одна правильна відповідь. ' +
      'Курс тесту має бути ACTIVE. DRAFT знімає публікацію без цієї перевірки. ' +
      'Повтор того самого статусу нічого не записує.',
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
