import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DayOfWeek, TimeOffType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsPlainText } from '../../common/validators/plain-text.decorator';
import {
  IsScheduleBoundary,
  REQUIRED_FIELD_MESSAGE,
  SCHEDULE_DEFAULT_RANGE_DAYS,
  SCHEDULE_MAX_RANGE_DAYS,
  ZONED_DATE_TIME_PATTERN,
} from './lessons.dto';

/** Збігається з CHECK end_minute <= 1440 у міграції add_instructor_schedule. */
export const MINUTES_PER_DAY = 1440;
/** Із запасом більше за будь-який реальний тиждень; захищає від надто великого пакета. */
export const WORKING_HOURS_MAX_INTERVALS = 50;
/** Збігається з VarChar(500) колонки reason. */
export const TIME_OFF_REASON_MAX_LENGTH = 500;
/** Найдовша недоступність одним записом. */
export const TIME_OFF_MAX_DAYS = 366;

export const DAY_OF_WEEK_MESSAGE =
  'dayOfWeek має бути MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY або SUNDAY.';
export const WORKING_HOURS_START_FORMAT_MESSAGE =
  'start має бути часом HH:MM від 00:00 до 23:59, наприклад 09:00.';
export const WORKING_HOURS_END_FORMAT_MESSAGE =
  'end має бути часом HH:MM від 00:01 до 24:00, наприклад 18:00.';
export const WORKING_HOURS_INTERVALS_MESSAGE = `intervals має бути масивом до ${WORKING_HOURS_MAX_INTERVALS} елементів.`;
export const TIME_OFF_TYPE_MESSAGE =
  'type має бути VACATION, SICK_LEAVE, DAY_OFF або OTHER.';
export const TIME_OFF_DATE_FORMAT_MESSAGE =
  'Дата має бути у форматі YYYY-MM-DD.';
export const TIME_OFF_INSTANT_FORMAT_MESSAGE =
  'startsAt і endsAt мають бути датою й часом ISO 8601 з часовим зсувом, наприклад 2026-11-20T10:00:00+02:00.';
export const TIME_OFF_REASON_LENGTH_MESSAGE = `Причина має містити не більше ${TIME_OFF_REASON_MAX_LENGTH} символів.`;

const START_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const END_PATTERN = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** Необов'язкова місцева дата YYYY-MM-DD; null відхиляється. */
function IsOptionalLocalDate() {
  return applyDecorators(
    IsISO8601({ strict: true }, { message: TIME_OFF_DATE_FORMAT_MESSAGE }),
    Matches(DATE_ONLY_PATTERN, { message: TIME_OFF_DATE_FORMAT_MESSAGE }),
    IsString({ message: TIME_OFF_DATE_FORMAT_MESSAGE }),
    ValidateIf((_, value) => value !== undefined),
  );
}

/** Необов'язковий момент ISO 8601 з часовим зсувом; null відхиляється. */
function IsOptionalInstant() {
  return applyDecorators(
    IsISO8601({ strict: true }, { message: TIME_OFF_INSTANT_FORMAT_MESSAGE }),
    Matches(ZONED_DATE_TIME_PATTERN, {
      message: TIME_OFF_INSTANT_FORMAT_MESSAGE,
    }),
    IsString({ message: TIME_OFF_INSTANT_FORMAT_MESSAGE }),
    ValidateIf((_, value) => value !== undefined),
  );
}

/** Інтервал робочого часу. Той самий клас — у запиті й у відповіді. */
export class WorkingHoursIntervalDto {
  @ApiProperty({ enum: DayOfWeek, example: DayOfWeek.MONDAY })
  @IsEnum(DayOfWeek, { message: DAY_OF_WEEK_MESSAGE })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  dayOfWeek: DayOfWeek;

  @ApiProperty({
    example: '09:00',
    pattern: START_PATTERN.source,
    description: 'Початок, HH:MM у часовому поясі автошколи.',
  })
  @Matches(START_PATTERN, { message: WORKING_HOURS_START_FORMAT_MESSAGE })
  @IsString({ message: WORKING_HOURS_START_FORMAT_MESSAGE })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  start: string;

  @ApiProperty({
    example: '13:00',
    pattern: END_PATTERN.source,
    description:
      'Кінець, не включно: HH:MM пізніше за start, 24:00 — до півночі. Інтервал через північ не підтримується.',
  })
  @Matches(END_PATTERN, { message: WORKING_HOURS_END_FORMAT_MESSAGE })
  @IsString({ message: WORKING_HOURS_END_FORMAT_MESSAGE })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  end: string;
}

export class ReplaceWorkingHoursDto {
  @ApiProperty({
    type: [WorkingHoursIntervalDto],
    maxItems: WORKING_HOURS_MAX_INTERVALS,
    example: [
      { dayOfWeek: 'MONDAY', start: '09:00', end: '13:00' },
      { dayOfWeek: 'MONDAY', start: '14:00', end: '18:00' },
      { dayOfWeek: 'TUESDAY', start: '09:00', end: '18:00' },
    ],
    description:
      'Увесь робочий тиждень: замінює попередній графік цілком. Кілька інтервалів на день — перерви між ними. ' +
      'Інтервали одного дня не перетинаються (впритул можна). Порожній масив очищає графік.',
  })
  // stopAtFirstError: перевірки йдуть знизу вгору, вкладені — лише коли масив
  // сам по собі коректний. Перетин і порядок start/end перевіряє сервіс.
  @ValidateNested({ each: true })
  @Type(() => WorkingHoursIntervalDto)
  @ArrayMaxSize(WORKING_HOURS_MAX_INTERVALS, {
    message: WORKING_HOURS_INTERVALS_MESSAGE,
  })
  @IsArray({ message: WORKING_HOURS_INTERVALS_MESSAGE })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  intervals: WorkingHoursIntervalDto[];
}

export class WorkingHoursDto {
  @ApiProperty({ format: 'uuid' })
  instructorId: string;

  @ApiProperty({
    example: 'Europe/Kyiv',
    description: 'Часовий пояс автошколи: у ньому задано start і end.',
  })
  timezone: string;

  @ApiProperty({
    type: [WorkingHoursIntervalDto],
    description: 'Інтервали за днем тижня (з понеділка) і за start.',
  })
  intervals: WorkingHoursIntervalDto[];
}

/**
 * Недоступність задається однією з двох форм:
 * цілі дні — startDate (+ endDate), або точні межі — startsAt і endsAt.
 * Поєднання форм і порядок меж перевіряє сервіс.
 */
export class CreateTimeOffDto {
  @ApiPropertyOptional({
    enum: TimeOffType,
    default: TimeOffType.DAY_OFF,
    example: TimeOffType.SICK_LEAVE,
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(TimeOffType, { message: TIME_OFF_TYPE_MESSAGE })
  type?: TimeOffType;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-11-20',
    description:
      'Перший день недоступності (місцева дата автошколи). Разом з endDate; не разом зі startsAt/endsAt.',
  })
  @IsOptionalLocalDate()
  startDate?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-11-22',
    description:
      'Останній день недоступності, включно. За замовчуванням — startDate (один день).',
  })
  @IsOptionalLocalDate()
  endDate?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-11-20T10:00:00+02:00',
    description:
      'Початок недоступності на частину дня. Разом з endsAt; не разом зі startDate/endDate.',
  })
  @IsOptionalInstant()
  startsAt?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-11-20T12:00:00+02:00',
    description: 'Кінець недоступності, не включно. Пізніше за startsAt.',
  })
  @IsOptionalInstant()
  endsAt?: string;

  @ApiPropertyOptional({
    example: 'Лікарняний',
    maxLength: TIME_OFF_REASON_MAX_LENGTH,
    description: 'Необов’язкова причина. Пробіли по краях обрізаються.',
  })
  @Transform(trimString)
  @ValidateIf((_, value) => value !== undefined)
  @IsPlainText()
  @MaxLength(TIME_OFF_REASON_MAX_LENGTH, {
    message: TIME_OFF_REASON_LENGTH_MESSAGE,
  })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'reason має бути рядком.' })
  reason?: string;
}

/** Інструктор — у шляху, організація — з access token. */
export class TimeOffListQueryDto {
  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-11-16T00:00:00+02:00',
    description:
      'Початок вікна, ISO 8601 з часовим зсувом. За замовчуванням — поточний момент. Знак + кодуйте як %2B.',
  })
  @IsScheduleBoundary()
  from?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-12-16T00:00:00+02:00',
    description:
      `Кінець вікна, не включно. За замовчуванням — from + ${SCHEDULE_DEFAULT_RANGE_DAYS} днів. ` +
      `Має бути пізніше за from, але не більше ніж на ${SCHEDULE_MAX_RANGE_DAYS} днів.`,
  })
  @IsScheduleBoundary()
  to?: string;
}

export class TimeOffDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  instructorId: string;

  @ApiProperty({ enum: TimeOffType, example: TimeOffType.SICK_LEAVE })
  type: TimeOffType;

  @ApiProperty({ type: String, nullable: true, example: 'Лікарняний' })
  reason: string | null;

  @ApiProperty({ example: '2026-11-19T22:00:00.000Z' })
  startsAt: Date;

  @ApiProperty({
    example: '2026-11-22T22:00:00.000Z',
    description: 'Не включно. Для цілих днів — північ після останнього дня.',
  })
  endsAt: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class TimeOffListDto {
  @ApiProperty({ example: '2026-11-15T22:00:00.000Z' })
  from: Date;

  @ApiProperty({ example: '2026-12-15T22:00:00.000Z' })
  to: Date;

  @ApiProperty({ example: 'Europe/Kyiv' })
  timezone: string;

  @ApiProperty({
    type: [TimeOffDto],
    description: 'Недоступності, що перетинають вікно [from, to), за startsAt.',
  })
  items: TimeOffDto[];
}
