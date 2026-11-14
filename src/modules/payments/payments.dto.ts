import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentHistoryAction, PaymentStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsIn,
  IsInt,
  IsISO4217CurrencyCode,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsPlainText } from '../../common/validators/plain-text.decorator';

export const PAYMENT_SORT_FIELDS = [
  'lastName',
  'firstName',
  'paidAt',
  'createdAt',
] as const;

export type PaymentSortField = (typeof PAYMENT_SORT_FIELDS)[number];

export const PAYMENT_SORT_ORDERS = ['asc', 'desc'] as const;

export type PaymentSortOrder = (typeof PAYMENT_SORT_ORDERS)[number];

export const DEFAULT_CURRENCY = 'UAH';
/** Межа DECIMAL(12,2). */
export const PAYMENT_AMOUNT_MAX = 9_999_999_999.99;
export const PAYMENT_COMMENT_MAX_LENGTH = 1000;
export const PAYMENT_PURPOSE_MAX_LENGTH = 255;

export const PAYMENT_RECORD_SORT_FIELDS = [
  'createdAt',
  'paidAt',
  'amount',
] as const;

export type PaymentRecordSortField =
  (typeof PAYMENT_RECORD_SORT_FIELDS)[number];

const SEARCH_MAX_LENGTH = 100;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_PAGE = 10_000;
const MAX_LIMIT = 100;

export const REQUIRED_FIELD_MESSAGE = "Заповніть обов'язкове поле.";
export const AMOUNT_NUMBER_MESSAGE =
  'amount має бути числом з не більше ніж двома знаками після коми.';
export const AMOUNT_NEGATIVE_MESSAGE = "Сума не може бути від'ємною.";
export const AMOUNT_MAX_MESSAGE = `Сума не може перевищувати ${PAYMENT_AMOUNT_MAX}.`;
export const CURRENCY_MESSAGE =
  'currency має бути кодом валюти ISO 4217, наприклад UAH.';
export const PAYMENT_STATUS_MESSAGE = 'status має бути NOT_PAID або PAID.';
export const DATE_FORMAT_MESSAGE =
  'Дата має бути у форматі ISO 8601, наприклад 2026-08-10 або 2026-08-10T12:00:00Z.';
export const COMMENT_LENGTH_MESSAGE = `Коментар має містити не більше ${PAYMENT_COMMENT_MAX_LENGTH} символів.`;
export const PURPOSE_LENGTH_MESSAGE = `Призначення платежу має містити не більше ${PAYMENT_PURPOSE_MAX_LENGTH} символів.`;

function optionalTrimmedString({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Порожній коментар — це null: в update він очищує поле, у create його просто немає. */
function nullableTrimmedString({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function trimmedString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function upperCaseString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

function optionalInteger({ value }: { value: unknown }): unknown {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return typeof value === 'number' ? value : Number(value);
}

/** Поле передано, зокрема як null: тоді воно перевіряється, і null відхиляється. */
function isPresent(_object: object, value: unknown): boolean {
  return value !== undefined;
}

function AmountRules() {
  return applyDecorators(
    IsNumber(
      { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 },
      { message: AMOUNT_NUMBER_MESSAGE },
    ),
    Min(0, { message: AMOUNT_NEGATIVE_MESSAGE }),
    Max(PAYMENT_AMOUNT_MAX, { message: AMOUNT_MAX_MESSAGE }),
  );
}

/** Призначення: непорожній рядок без розмітки. Порожній після trim — «заповніть поле». */
function PurposeRules() {
  return applyDecorators(
    IsString({ message: 'purpose має бути рядком.' }),
    IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE }),
    MaxLength(PAYMENT_PURPOSE_MAX_LENGTH, { message: PURPOSE_LENGTH_MESSAGE }),
    IsPlainText(),
  );
}

function CommentRules() {
  return applyDecorators(
    IsString({ message: 'comment має бути рядком.' }),
    MaxLength(PAYMENT_COMMENT_MAX_LENGTH, { message: COMMENT_LENGTH_MESSAGE }),
    IsPlainText(),
  );
}

class PaginationQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PAGE,
    default: DEFAULT_PAGE,
    example: DEFAULT_PAGE,
  })
  @Transform(optionalInteger)
  @IsOptional()
  @IsInt({ message: 'page має бути цілим числом.' })
  @Min(1, { message: 'page має бути не менше 1.' })
  @Max(MAX_PAGE, { message: 'page занадто великий.' })
  page?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_LIMIT,
    default: DEFAULT_LIMIT,
    example: DEFAULT_LIMIT,
  })
  @Transform(optionalInteger)
  @IsOptional()
  @IsInt({ message: 'limit має бути цілим числом.' })
  @Min(1, { message: 'limit має бути не менше 1.' })
  @Max(MAX_LIMIT, { message: 'limit має бути не більше 100.' })
  limit?: number;
}

export class ListPaymentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: "Пошук за ім'ям, прізвищем, email або телефоном студента.",
    example: 'Коваль',
    maxLength: SEARCH_MAX_LENGTH,
  })
  @Transform(optionalTrimmedString)
  @IsOptional()
  @IsString({ message: 'search має бути рядком.' })
  @MaxLength(SEARCH_MAX_LENGTH, {
    message: `search має містити не більше ${SEARCH_MAX_LENGTH} символів.`,
  })
  search?: string;

  @ApiPropertyOptional({
    enum: PaymentStatus,
    description:
      'Фільтр за актуальним статусом. NOT_PAID включає студентів без жодної оплати.',
    example: PaymentStatus.NOT_PAID,
  })
  @IsOptional()
  @IsEnum(PaymentStatus, { message: PAYMENT_STATUS_MESSAGE })
  status?: PaymentStatus;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Фільтр за навчальною групою своєї автошколи.',
    example: '12121212-1212-4121-8121-121212121212',
  })
  @IsOptional()
  @IsUUID('4', { message: 'groupId має бути UUID.' })
  groupId?: string;

  @ApiPropertyOptional({
    enum: PAYMENT_SORT_FIELDS,
    default: 'lastName',
    description:
      'Поле сортування. paidAt — дата актуальної оплати; студенти без неї завжди в кінці.',
  })
  @IsOptional()
  @IsIn(PAYMENT_SORT_FIELDS, {
    message: 'sortBy має бути lastName, firstName, paidAt або createdAt.',
  })
  sortBy?: PaymentSortField;

  @ApiPropertyOptional({ enum: PAYMENT_SORT_ORDERS, default: 'asc' })
  @IsOptional()
  @IsIn(PAYMENT_SORT_ORDERS, { message: 'sortOrder має бути asc або desc.' })
  sortOrder?: PaymentSortOrder;
}

export class ListPaymentRecordsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Оплати одного студента (id користувача).',
    example: '88888888-8888-4888-8888-888888888888',
  })
  @IsOptional()
  @IsUUID('4', { message: 'studentId має бути UUID.' })
  studentId?: string;

  @ApiPropertyOptional({
    enum: PaymentStatus,
    description: 'Статус самого запису оплати (не актуальний статус студента).',
  })
  @IsOptional()
  @IsEnum(PaymentStatus, { message: PAYMENT_STATUS_MESSAGE })
  status?: PaymentStatus;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Оплати студентів навчальної групи своєї автошколи.',
  })
  @IsOptional()
  @IsUUID('4', { message: 'groupId має бути UUID.' })
  groupId?: string;

  @ApiPropertyOptional({
    description: "Пошук студента за ім'ям, прізвищем, email або телефоном.",
    maxLength: SEARCH_MAX_LENGTH,
  })
  @Transform(optionalTrimmedString)
  @IsOptional()
  @IsString({ message: 'search має бути рядком.' })
  @MaxLength(SEARCH_MAX_LENGTH, {
    message: `search має містити не більше ${SEARCH_MAX_LENGTH} символів.`,
  })
  search?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Підтверджені оплати з цієї дати включно (paidAt).',
    example: '2026-08-01',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: DATE_FORMAT_MESSAGE })
  paidFrom?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Підтверджені оплати до цієї дати (не включно, paidAt).',
    example: '2026-09-01',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: DATE_FORMAT_MESSAGE })
  paidTo?: string;

  @ApiPropertyOptional({
    enum: PAYMENT_RECORD_SORT_FIELDS,
    default: 'createdAt',
    description:
      'Поле сортування. Оплати без paidAt при сортуванні за paidAt — у кінці.',
  })
  @IsOptional()
  @IsIn(PAYMENT_RECORD_SORT_FIELDS, {
    message: 'sortBy має бути createdAt, paidAt або amount.',
  })
  sortBy?: PaymentRecordSortField;

  @ApiPropertyOptional({ enum: PAYMENT_SORT_ORDERS, default: 'desc' })
  @IsOptional()
  @IsIn(PAYMENT_SORT_ORDERS, { message: 'sortOrder має бути asc або desc.' })
  sortOrder?: PaymentSortOrder;
}

export class PaymentHistoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Id користувача-студента.',
  })
  @IsOptional()
  @IsUUID('4', { message: 'studentId має бути UUID.' })
  studentId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'paymentId має бути UUID.' })
  paymentId?: string;

  @ApiPropertyOptional({ enum: PaymentHistoryAction })
  @IsOptional()
  @IsEnum(PaymentHistoryAction, {
    message: 'action має бути CREATED, STATUS_CHANGED або UPDATED.',
  })
  action?: PaymentHistoryAction;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Події з цього моменту включно.',
    example: '2026-08-01T00:00:00Z',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: DATE_FORMAT_MESSAGE })
  from?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Події до цього моменту (не включно).',
    example: '2026-09-01T00:00:00Z',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: DATE_FORMAT_MESSAGE })
  to?: string;
}

export class CreatePaymentDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Id користувача-студента своєї автошколи (той самий, що в /students).',
    example: '88888888-8888-4888-8888-888888888888',
  })
  @IsUUID('4', { message: 'studentId має бути UUID.' })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  studentId: string;

  @ApiProperty({
    example: 5000,
    minimum: 0,
    maximum: PAYMENT_AMOUNT_MAX,
    description:
      'Сума, не більше двох знаків після коми. Для PAID — більше за 0.',
  })
  @AmountRules()
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  amount: number;

  @ApiPropertyOptional({
    example: DEFAULT_CURRENCY,
    default: DEFAULT_CURRENCY,
    description: 'Код валюти ISO 4217.',
  })
  @Transform(upperCaseString)
  @IsOptional()
  @IsISO4217CurrencyCode({ message: CURRENCY_MESSAGE })
  currency?: string;

  @ApiPropertyOptional({
    enum: PaymentStatus,
    default: PaymentStatus.PAID,
    description: 'За замовчуванням PAID.',
  })
  @IsOptional()
  @IsEnum(PaymentStatus, { message: PAYMENT_STATUS_MESSAGE })
  status?: PaymentStatus;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-08-10',
    description:
      'Дата оплати. Обовʼязкова для PAID, заборонена для NOT_PAID. Не в майбутньому.',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: DATE_FORMAT_MESSAGE })
  paidAt?: string;

  @ApiProperty({
    maxLength: PAYMENT_PURPOSE_MAX_LENGTH,
    example: 'Курс теорії, категорія B',
    description: 'Призначення платежу: за що оплата. Бачить і студент.',
  })
  @Transform(trimmedString)
  @PurposeRules()
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  purpose: string;

  @ApiPropertyOptional({
    maxLength: PAYMENT_COMMENT_MAX_LENGTH,
    example: 'Готівка, квитанція №125',
    description: 'Службовий коментар ADMIN. Студенту не повертається.',
  })
  @Transform(optionalTrimmedString)
  @IsOptional()
  @CommentRules()
  comment?: string;
}

export class UpdatePaymentDto {
  @ApiPropertyOptional({
    example: 5500,
    minimum: 0,
    maximum: PAYMENT_AMOUNT_MAX,
    description: 'Нова сума. null не приймається: суму не можна очистити.',
  })
  // Не @IsOptional: той пропускає null, а null — це не сума (400, а не 500).
  @ValidateIf(isPresent)
  @AmountRules()
  amount?: number;

  @ApiPropertyOptional({ example: DEFAULT_CURRENCY })
  @Transform(upperCaseString)
  @ValidateIf(isPresent)
  @IsISO4217CurrencyCode({ message: CURRENCY_MESSAGE })
  currency?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-08-11',
    description:
      'Нова дата оплати. Лише для оплати зі статусом PAID; очистити її не можна.',
  })
  @ValidateIf(isPresent)
  @IsISO8601({ strict: true }, { message: DATE_FORMAT_MESSAGE })
  paidAt?: string;

  @ApiPropertyOptional({
    maxLength: PAYMENT_PURPOSE_MAX_LENGTH,
    example: 'Практичне водіння, 10 годин',
    description: 'Нове призначення платежу. Очистити його не можна.',
  })
  @Transform(trimmedString)
  @ValidateIf(isPresent)
  @PurposeRules()
  purpose?: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    maxLength: PAYMENT_COMMENT_MAX_LENGTH,
    description: 'null або порожній рядок очищує коментар.',
  })
  @Transform(nullableTrimmedString)
  @IsOptional()
  @CommentRules()
  comment?: string | null;
}

export class UpdatePaymentStatusDto {
  @ApiProperty({
    enum: PaymentStatus,
    example: PaymentStatus.PAID,
    description: 'У MVP дозволено лише NOT_PAID → PAID. PAID — фінальний.',
  })
  @IsEnum(PaymentStatus, { message: PAYMENT_STATUS_MESSAGE })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  status: PaymentStatus;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-08-10',
    description: 'Дата оплати для PAID. За замовчуванням — момент запиту.',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: DATE_FORMAT_MESSAGE })
  paidAt?: string;

  @ApiPropertyOptional({
    maxLength: PAYMENT_COMMENT_MAX_LENGTH,
    description: 'Коментар до зміни. Пишеться в журнал, а не в оплату.',
  })
  @Transform(optionalTrimmedString)
  @IsOptional()
  @CommentRules()
  comment?: string;
}

export class PaymentPersonDto {
  @ApiProperty({ example: '22222222-2222-4222-8222-222222222222' })
  id: string;

  @ApiProperty({ example: 'Ірина' })
  firstName: string;

  @ApiProperty({ example: 'Адміненко' })
  lastName: string;
}

export class PaymentGroupDto {
  @ApiProperty({ example: '12121212-1212-4121-8121-121212121212' })
  id: string;

  @ApiProperty({ example: 'Група B-12' })
  name: string;
}

export class PaymentStudentDto {
  @ApiProperty({
    example: '88888888-8888-4888-8888-888888888888',
    description: 'Id користувача-студента.',
  })
  id: string;

  @ApiProperty({ example: 'Олена' })
  firstName: string;

  @ApiProperty({ example: 'Коваль' })
  lastName: string;

  @ApiProperty({ example: 'student@example.com' })
  email: string;

  @ApiProperty({ type: PaymentGroupDto, nullable: true })
  group: PaymentGroupDto | null;
}

export class PaymentDto {
  @ApiProperty({ example: '44444444-4444-4444-8444-444444444444' })
  id: string;

  @ApiProperty({ example: '11111111-1111-1111-1111-111111111111' })
  organizationId: string;

  @ApiProperty({
    example: '88888888-8888-4888-8888-888888888888',
    description: 'Id користувача-студента.',
  })
  studentId: string;

  @ApiProperty({
    example: '5000.00',
    description: 'Сума рядком з двома знаками після коми — без похибок float.',
  })
  amount: string;

  @ApiProperty({ example: DEFAULT_CURRENCY })
  currency: string;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.PAID })
  status: PaymentStatus;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Дата підтвердженої оплати. null для NOT_PAID.',
  })
  paidAt: Date | null;

  @ApiProperty({
    example: 'Курс теорії, категорія B',
    description: 'Призначення платежу.',
  })
  purpose: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Службовий коментар ADMIN. Студенту не повертається.',
  })
  comment?: string | null;

  @ApiProperty({ type: PaymentPersonDto, description: 'Хто створив запис.' })
  createdBy: PaymentPersonDto;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

export const PAYMENT_EDITABLE_FIELDS = [
  'amount',
  'currency',
  'paidAt',
  'purpose',
  'comment',
] as const;

export type PaymentEditableField = (typeof PAYMENT_EDITABLE_FIELDS)[number];

export type PaymentFieldChange = { from: string | null; to: string | null };

export type PaymentChanges = Partial<
  Record<PaymentEditableField, PaymentFieldChange>
>;

export class PaymentHistoryItemDto {
  @ApiProperty({ example: '55555555-5555-4555-8555-555555555555' })
  id: string;

  @ApiProperty({ example: '44444444-4444-4444-8444-444444444444' })
  paymentId: string;

  @ApiProperty({
    example: '88888888-8888-4888-8888-888888888888',
    description: 'Id користувача-студента, якому належить оплата.',
  })
  studentId: string;

  @ApiProperty({ enum: PaymentHistoryAction })
  action: PaymentHistoryAction;

  @ApiProperty({ enum: PaymentStatus, nullable: true })
  previousStatus: PaymentStatus | null;

  @ApiProperty({ enum: PaymentStatus })
  newStatus: PaymentStatus;

  @ApiProperty({
    type: 'object',
    nullable: true,
    description:
      'Для UPDATED — змінені поля (amount, currency, paidAt, comment): ' +
      '{ "amount": { "from": "5000.00", "to": "5500.00" } }. Для інших подій — null.',
    additionalProperties: {
      type: 'object',
      properties: {
        from: { type: 'string', nullable: true },
        to: { type: 'string', nullable: true },
      },
    },
    example: { amount: { from: '5000.00', to: '5500.00' } },
  })
  changes: PaymentChanges | null;

  @ApiProperty({ type: PaymentPersonDto })
  changedBy: PaymentPersonDto;

  @ApiProperty({ type: String, format: 'date-time' })
  changedAt: Date;

  @ApiProperty({ type: String, nullable: true })
  comment: string | null;
}

export class PaymentDetailsDto extends PaymentDto {
  @ApiProperty({ type: PaymentStudentDto })
  student: PaymentStudentDto;

  @ApiProperty({
    type: [PaymentHistoryItemDto],
    description: 'Журнал цієї оплати, від нових подій до старих.',
  })
  history: PaymentHistoryItemDto[];
}

export class CurrentPaymentDto {
  @ApiProperty({ example: '44444444-4444-4444-8444-444444444444' })
  id: string;

  @ApiProperty({ example: '5000.00' })
  amount: string;

  @ApiProperty({ example: DEFAULT_CURRENCY })
  currency: string;

  @ApiProperty({ enum: PaymentStatus })
  status: PaymentStatus;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  paidAt: Date | null;

  @ApiProperty({ example: 'Курс теорії, категорія B' })
  purpose: string;
}

export class PaymentOverviewItemDto {
  @ApiProperty({ type: PaymentStudentDto })
  student: PaymentStudentDto;

  @ApiProperty({
    enum: PaymentStatus,
    description:
      'Актуальний статус: status останньої оплати, NOT_PAID — якщо оплат немає.',
  })
  status: PaymentStatus;

  @ApiProperty({
    type: CurrentPaymentDto,
    nullable: true,
    description: 'Остання оплата студента. null — оплат ще немає.',
  })
  currentPayment: CurrentPaymentDto | null;
}

export class PaymentPaginationDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 1 })
  total: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}

export class PaymentOverviewListDto {
  @ApiProperty({ type: [PaymentOverviewItemDto] })
  students: PaymentOverviewItemDto[];

  @ApiProperty({ type: PaymentPaginationDto })
  pagination: PaymentPaginationDto;
}

export class PaymentHistoryListDto {
  @ApiProperty({ type: [PaymentHistoryItemDto] })
  history: PaymentHistoryItemDto[];

  @ApiProperty({ type: PaymentPaginationDto })
  pagination: PaymentPaginationDto;
}

export class PaymentRecordDto extends PaymentDto {
  @ApiProperty({ type: PaymentStudentDto })
  student: PaymentStudentDto;

  @ApiProperty({
    description:
      'true — це остання оплата студента, тобто саме вона задає його актуальний статус.',
  })
  isCurrent: boolean;
}

export class PaymentRecordListDto {
  @ApiProperty({ type: [PaymentRecordDto] })
  payments: PaymentRecordDto[];

  @ApiProperty({ type: PaymentPaginationDto })
  pagination: PaymentPaginationDto;
}

export class PaymentTotalDto {
  @ApiProperty({ example: DEFAULT_CURRENCY })
  currency: string;

  @ApiProperty({ example: '8000.00' })
  amount: string;
}

export class StudentPaymentSummaryDto {
  @ApiProperty({
    enum: PaymentStatus,
    description:
      'Актуальний статус: status останньої оплати, NOT_PAID — якщо оплат немає. ' +
      'Практику можна бронювати лише з PAID.',
  })
  status: PaymentStatus;

  @ApiProperty({
    type: PaymentDto,
    nullable: true,
    description: 'Остання оплата. null — оплат ще немає.',
  })
  currentPayment: PaymentDto | null;

  @ApiProperty({
    type: [PaymentTotalDto],
    description: 'Сума підтверджених (PAID) оплат окремо за кожною валютою.',
  })
  totalsPaid: PaymentTotalDto[];

  @ApiProperty({
    type: [PaymentDto],
    description: 'Історія оплат, від нових до старих.',
  })
  payments: PaymentDto[];
}
