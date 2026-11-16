import {
  Body,
  Controller,
  Get,
  Headers,
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
  ApiHeader,
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
  CreatePaymentDto,
  ListPaymentRecordsQueryDto,
  ListPaymentsQueryDto,
  PaymentDetailsDto,
  PaymentDto,
  PaymentHistoryListDto,
  PaymentHistoryQueryDto,
  PaymentOverviewListDto,
  PaymentRecordListDto,
  UpdatePaymentDto,
  UpdatePaymentStatusDto,
} from './payments.dto';
import { IDEMPOTENCY_KEY_HEADER } from './payment-idempotency';
import { PAYMENT_MANAGE_ROLES, PaymentsService } from './payments.service';

const FORBIDDEN_DESCRIPTION =
  'Оплати веде лише OWNER або ADMIN. TEACHER, INSTRUCTOR і STUDENT доступу не мають.';
const BAD_REQUEST_DESCRIPTION =
  'Некоректні дані. Тіло містить errors: [{ field, message }].';

const paymentIdParam = {
  name: 'id',
  format: 'uuid',
  example: '44444444-4444-4444-8444-444444444444',
} as const;

@ApiTags('payments')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@ApiForbiddenResponse({ description: FORBIDDEN_DESCRIPTION })
@Controller('payments')
@UseGuards(AuthGuard, RolesGuard)
@Roles(...PAYMENT_MANAGE_ROLES)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @ApiOperation({
    summary: 'Оплати: студенти автошколи та їх актуальний статус',
    description:
      'Один рядок на студента своєї автошколи, зокрема студента без жодної оплати. ' +
      'Актуальний статус — status останньої оплати студента за createdAt; без оплат — NOT_PAID. ' +
      'currentPayment — сума, валюта і дата цієї оплати. ' +
      'search шукає за іменем, прізвищем, email або телефоном; status і groupId — фільтри; ' +
      'sortBy/sortOrder і пагінація page/limit. organizationId береться з access token.',
  })
  @ApiOkResponse({ type: PaymentOverviewListDto })
  @ApiBadRequestResponse({ description: BAD_REQUEST_DESCRIPTION })
  @ApiNotFoundResponse({
    description: 'Автошколу не знайдено або її видалено.',
  })
  overview(@CurrentUser() user: User, @Query() query: ListPaymentsQueryDto) {
    return this.paymentsService.overview(user, query);
  }

  // Оголошено перед GET :id, інакше «records» розбирався б як id.
  @Get('records')
  @ApiOperation({
    summary: 'Список оплат автошколи',
    description:
      'Окремі записи оплат (не студенти) від нових до старих. Кожен рядок містить суму, валюту, ' +
      'статус, дату оплати, призначення, автора і студента; isCurrent — чи саме ця оплата задає ' +
      'актуальний статус студента. Фільтри: studentId (id користувача), status (статус запису), ' +
      'groupId, search (студент), [paidFrom, paidTo) за paidAt. sortBy: createdAt, paidAt, amount. ' +
      'Пагінація page/limit. organizationId береться з access token.',
  })
  @ApiOkResponse({ type: PaymentRecordListDto })
  @ApiBadRequestResponse({ description: BAD_REQUEST_DESCRIPTION })
  @ApiNotFoundResponse({
    description: 'Автошколу не знайдено або її видалено.',
  })
  records(
    @CurrentUser() user: User,
    @Query() query: ListPaymentRecordsQueryDto,
  ) {
    return this.paymentsService.records(user, query);
  }

  // Оголошено перед GET :id, інакше «history» розбирався б як id.
  @Get('history')
  @ApiOperation({
    summary: 'Журнал змін оплат автошколи',
    description:
      'Створення, зміни статусу і зміни суми, валюти, дати чи коментаря — від нових до старих. ' +
      'Фільтри studentId (id користувача), paymentId, action і проміжок [from, to). ' +
      'Записи журналу не змінюються і не видаляються.',
  })
  @ApiOkResponse({ type: PaymentHistoryListDto })
  @ApiBadRequestResponse({ description: BAD_REQUEST_DESCRIPTION })
  @ApiNotFoundResponse({
    description: 'Автошколу не знайдено або її видалено.',
  })
  history(@CurrentUser() user: User, @Query() query: PaymentHistoryQueryDto) {
    return this.paymentsService.history(user, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Деталі оплати',
    description:
      'Оплата, студент і журнал її змін. Оплата іншої автошколи повертає 404.',
  })
  @ApiParam(paymentIdParam)
  @ApiOkResponse({ type: PaymentDetailsDto })
  @ApiNotFoundResponse({
    description: 'Оплату не знайдено або вона належить іншій автошколі.',
  })
  getById(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.paymentsService.getById(user, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Додати оплату студенту',
    description:
      'Студент має належати автошколі ADMIN і не бути архівованим. purpose (призначення платежу) ' +
      'обовʼязкове. status за замовчуванням PAID, ' +
      'currency — UAH. Для PAID обовʼязкові paidAt і amount > 0; для NOT_PAID paidAt не передається. ' +
      'paidAt не може бути в майбутньому. createdBy — поточний користувач. Нова оплата стає ' +
      'останньою, тож її статус стає актуальним статусом студента. Подія CREATED пишеться в журнал. ' +
      'organizationId у тілі не приймається. ' +
      'Передайте заголовок Idempotency-Key (наприклад, UUID на кожну нову оплату): повтор запиту ' +
      'з тим самим ключем і тими самими даними повертає ту саму оплату, не створюючи другу.',
  })
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: false,
    description:
      'Ключ ідемпотентності: 8–128 символів [A-Za-z0-9_.:-], унікальний для кожної нової оплати. ' +
      'Повтор з тим самим ключем і даними повертає ту саму оплату (201), з іншими даними — 409.',
    example: '3f0c2a6e-6b1d-4f7e-9c2a-1b2c3d4e5f60',
  })
  @ApiCreatedResponse({ type: PaymentDto })
  @ApiBadRequestResponse({ description: BAD_REQUEST_DESCRIPTION })
  @ApiConflictResponse({
    description:
      'Студента архівовано, або Idempotency-Key уже використано з іншими даними.',
  })
  @ApiNotFoundResponse({
    description:
      'Студента не знайдено, його видалено, або він належить іншій автошколі.',
  })
  create(
    @CurrentUser() user: User,
    @Body() body: CreatePaymentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.paymentsService.create(user, body, idempotencyKey);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Змінити статус оплати',
    description:
      'У MVP дозволено лише NOT_PAID → PAID; PAID — фінальний статус. paidAt за замовчуванням — ' +
      'момент запиту. Подія STATUS_CHANGED з попереднім і новим статусом, автором і датою ' +
      'пишеться в журнал. Помилку в підтвердженій оплаті виправляють новим записом.',
  })
  @ApiParam(paymentIdParam)
  @ApiOkResponse({ type: PaymentDto })
  @ApiBadRequestResponse({ description: BAD_REQUEST_DESCRIPTION })
  @ApiConflictResponse({
    description:
      'Оплата вже PAID, статус не змінюється, або сума оплати 0 (спершу змініть суму).',
  })
  @ApiNotFoundResponse({
    description: 'Оплату не знайдено або вона належить іншій автошколі.',
  })
  changeStatus(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdatePaymentStatusDto,
  ) {
    return this.paymentsService.changeStatus(user, id, body);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Редагувати дозволені дані оплати',
    description:
      'Змінюються amount, currency, paidAt, purpose і comment. status тут не приймається — ' +
      'лише PATCH /payments/{id}/status. paidAt — лише для оплати PAID. Змінені поля ' +
      '(було → стало) пишуться в журнал як подія UPDATED. Запит без змін нічого не пише.',
  })
  @ApiParam(paymentIdParam)
  @ApiOkResponse({ type: PaymentDto })
  @ApiBadRequestResponse({ description: BAD_REQUEST_DESCRIPTION })
  @ApiNotFoundResponse({
    description: 'Оплату не знайдено або вона належить іншій автошколі.',
  })
  update(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdatePaymentDto,
  ) {
    return this.paymentsService.update(user, id, body);
  }
}
