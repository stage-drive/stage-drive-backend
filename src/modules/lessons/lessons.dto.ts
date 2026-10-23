import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DrivingLessonStatus,
  LessonStatus,
  LicenseCategory,
  Transmission,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsDefined,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsPlainText } from '../../common/validators/plain-text.decorator';

/** Межі збігаються з CHECK на duration_min у міграції add_lesson_scheduling_fields. */
export const LESSON_MIN_DURATION_MIN = 15;
export const LESSON_MAX_DURATION_MIN = 240;
export const LESSON_TOPIC_MAX_LENGTH = 200;
/** Збігається з VarChar(500) колонки cancellation_reason. */
export const CANCELLATION_REASON_MAX_LENGTH = 500;

export const REQUIRED_FIELD_MESSAGE = "Заповніть обов'язкове поле.";
export const LESSON_TOPIC_LENGTH_MESSAGE = `Тема має містити не більше ${LESSON_TOPIC_MAX_LENGTH} символів.`;
export const CANCELLATION_REASON_LENGTH_MESSAGE = `Причина має містити не більше ${CANCELLATION_REASON_MAX_LENGTH} символів.`;
export const LESSON_DURATION_MESSAGE = `Тривалість має бути цілим числом хвилин від ${LESSON_MIN_DURATION_MIN} до ${LESSON_MAX_DURATION_MIN}.`;
export const SCHEDULED_AT_FORMAT_MESSAGE =
  'scheduledAt має бути датою й часом ISO 8601 з часовим зсувом, наприклад 2026-11-03T10:00:00+02:00.';

/** Секунди обов'язкові, мілісекунди — ні. Зсув обов'язковий: Z або ±HH:MM. */
export const ZONED_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

const DURATION_DESCRIPTION = `Тривалість у хвилинах, ціле число від ${LESSON_MIN_DURATION_MIN} до ${LESSON_MAX_DURATION_MIN}.`;

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** Необов'язкова тривалість; null відхиляється, як і будь-яке не-ціле число. */
function IsLessonDuration() {
  return applyDecorators(
    IsInt({ message: LESSON_DURATION_MESSAGE }),
    Min(LESSON_MIN_DURATION_MIN, { message: LESSON_DURATION_MESSAGE }),
    Max(LESSON_MAX_DURATION_MIN, { message: LESSON_DURATION_MESSAGE }),
    ValidateIf((_, value) => value !== undefined),
  );
}

export class UpdateTheoryLessonDto {
  @ApiPropertyOptional({
    example: 'Дорожні знаки: попереджувальні',
    maxLength: LESSON_TOPIC_MAX_LENGTH,
    description: 'Пробіли по краях обрізаються.',
  })
  @Transform(trimString)
  @ValidateIf((_, value) => value !== undefined)
  @IsPlainText()
  @MaxLength(LESSON_TOPIC_MAX_LENGTH, { message: LESSON_TOPIC_LENGTH_MESSAGE })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'topic має бути рядком.' })
  topic?: string;

  @ApiPropertyOptional({
    example: 90,
    minimum: LESSON_MIN_DURATION_MIN,
    maximum: LESSON_MAX_DURATION_MIN,
    description: DURATION_DESCRIPTION,
  })
  @IsLessonDuration()
  durationMin?: number;
}

export class UpdatePracticeLessonDto {
  @ApiPropertyOptional({
    example: 60,
    minimum: LESSON_MIN_DURATION_MIN,
    maximum: LESSON_MAX_DURATION_MIN,
    description: DURATION_DESCRIPTION,
  })
  @IsLessonDuration()
  durationMin?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    example: 'a3b2c1d0-0000-4000-8000-000000000000',
    description:
      'Новий інструктор: INSTRUCTOR зі статусом ACTIVE тієї самої автошколи. Змінити може лише ADMIN.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID('4', { message: 'instructorId має бути UUID.' })
  instructorId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: 'c7d2e1f0-0000-4000-8000-000000000000',
    description:
      'Авто заняття: AVAILABLE, призначене інструктору заняття, з категорією й коробкою як у студента.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID('4', { message: 'carId має бути UUID.' })
  carId?: string;
}

export class RescheduleLessonDto {
  @ApiProperty({
    format: 'date-time',
    example: '2026-11-03T10:00:00+02:00',
    description:
      'Новий початок заняття, ISO 8601 з часовим зсувом (Z або ±HH:MM). ' +
      'Щоб змінити лише дату, надішліть новий момент з тим самим місцевим часом у часовому поясі автошколи.',
  })
  @IsISO8601({ strict: true }, { message: SCHEDULED_AT_FORMAT_MESSAGE })
  @Matches(ZONED_DATE_TIME_PATTERN, { message: SCHEDULED_AT_FORMAT_MESSAGE })
  @IsString({ message: SCHEDULED_AT_FORMAT_MESSAGE })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  scheduledAt: string;

  @ApiPropertyOptional({
    example: 60,
    minimum: LESSON_MIN_DURATION_MIN,
    maximum: LESSON_MAX_DURATION_MIN,
    description: `${DURATION_DESCRIPTION} Без поля тривалість лишається поточною.`,
  })
  @IsLessonDuration()
  durationMin?: number;
}

export class CancelLessonDto {
  @ApiPropertyOptional({
    example: 'Викладач захворів',
    maxLength: CANCELLATION_REASON_MAX_LENGTH,
    description:
      'Необов’язкова причина скасування. Пробіли по краях обрізаються.',
  })
  @Transform(trimString)
  @ValidateIf((_, value) => value !== undefined)
  @IsPlainText()
  @MaxLength(CANCELLATION_REASON_MAX_LENGTH, {
    message: CANCELLATION_REASON_LENGTH_MESSAGE,
  })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'reason має бути рядком.' })
  reason?: string;
}

export class LessonPersonDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Ірина' })
  firstName: string;

  @ApiProperty({ example: 'Мельник' })
  lastName: string;
}

export class LessonGroupDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'ПДР — Група А' })
  name: string;
}

export class LessonCarDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'AA1234BB' })
  plateNumber: string;

  @ApiProperty({ enum: LicenseCategory, example: LicenseCategory.B })
  category: LicenseCategory;

  @ApiProperty({ enum: Transmission, example: Transmission.MANUAL })
  transmission: Transmission;
}

export class TheoryLessonDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ['THEORY'], example: 'THEORY' })
  type: 'THEORY';

  @ApiProperty({ enum: LessonStatus, example: LessonStatus.SCHEDULED })
  status: LessonStatus;

  @ApiProperty({ example: 'Дорожні знаки' })
  topic: string;

  @ApiProperty({ example: '2026-11-03T16:00:00.000Z' })
  scheduledAt: Date;

  @ApiProperty({
    example: '2026-11-03T17:30:00.000Z',
    description: 'scheduledAt + durationMin.',
  })
  endsAt: Date;

  @ApiProperty({ example: 90 })
  durationMin: number;

  @ApiProperty({ type: LessonGroupDto })
  group: LessonGroupDto;

  @ApiProperty({ type: LessonPersonDto, description: 'Викладач групи.' })
  teacher: LessonPersonDto;

  @ApiProperty({
    type: Date,
    nullable: true,
    example: null,
    description: 'Коли заняття скасовано; null, якщо не скасоване.',
  })
  cancelledAt: Date | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    maxLength: CANCELLATION_REASON_MAX_LENGTH,
    description: 'Причина скасування; null, якщо її не вказали.',
  })
  cancellationReason: string | null;

  @ApiProperty()
  updatedAt: Date;
}

export class PracticeLessonDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ['PRACTICE'], example: 'PRACTICE' })
  type: 'PRACTICE';

  @ApiProperty({
    enum: DrivingLessonStatus,
    example: DrivingLessonStatus.SCHEDULED,
  })
  status: DrivingLessonStatus;

  @ApiProperty({ example: '2026-11-03T08:00:00.000Z' })
  scheduledAt: Date;

  @ApiProperty({
    example: '2026-11-03T09:00:00.000Z',
    description: 'scheduledAt + durationMin.',
  })
  endsAt: Date;

  @ApiProperty({ example: 60 })
  durationMin: number;

  @ApiProperty({ type: LessonPersonDto })
  instructor: LessonPersonDto;

  @ApiProperty({ type: LessonPersonDto })
  student: LessonPersonDto;

  @ApiProperty({
    type: LessonCarDto,
    nullable: true,
    description: 'null лише для старого заняття без авто.',
  })
  car: LessonCarDto | null;

  @ApiProperty({
    type: Date,
    nullable: true,
    example: null,
    description: 'Коли заняття скасовано; null, якщо не скасоване.',
  })
  cancelledAt: Date | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    maxLength: CANCELLATION_REASON_MAX_LENGTH,
    description: 'Причина скасування; null, якщо її не вказали.',
  })
  cancellationReason: string | null;

  @ApiProperty()
  updatedAt: Date;
}

export class LessonConflictDto {
  @ApiProperty({
    enum: ['TEACHER', 'INSTRUCTOR', 'GROUP', 'CAR', 'STUDENT'],
    example: 'INSTRUCTOR',
    description: 'Ресурс, зайнятий іншим заняттям.',
  })
  resource: string;

  @ApiProperty({
    description: 'Id викладача, інструктора, групи, авто чи студента.',
  })
  resourceId: string;

  @ApiProperty({ enum: ['THEORY', 'PRACTICE'], example: 'PRACTICE' })
  lessonType: string;

  @ApiProperty({ description: 'Id заняття, з яким перетинається новий час.' })
  lessonId: string;

  @ApiProperty({ example: '2026-11-03T08:00:00.000Z' })
  scheduledAt: Date;

  @ApiProperty({ example: '2026-11-03T09:00:00.000Z' })
  endsAt: Date;
}

export class LessonScheduleConflictResponseDto {
  @ApiProperty({ example: 409 })
  statusCode: number;

  @ApiProperty({ example: 'Conflict' })
  error: string;

  @ApiProperty({ example: 'Обраний час конфліктує з іншими заняттями.' })
  message: string;

  @ApiProperty({ type: [LessonConflictDto] })
  conflicts: LessonConflictDto[];
}
