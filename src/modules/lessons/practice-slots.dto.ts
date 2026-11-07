import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDefined,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateIf,
} from 'class-validator';
import {
  IsLessonDuration,
  IsScheduleBoundary,
  IsScheduledAt,
  LESSON_MAX_DURATION_MIN,
  LESSON_MIN_DURATION_MIN,
  LessonCarDto,
  LessonPersonDto,
  PRACTICE_DEFAULT_DURATION_MIN,
  REQUIRED_FIELD_MESSAGE,
  SCHEDULE_DEFAULT_RANGE_DAYS,
  SCHEDULE_MAX_RANGE_DAYS,
  SCHEDULED_AT_FORMAT_MESSAGE,
  ZONED_DATE_TIME_PATTERN,
} from './lessons.dto';

const INSTRUCTOR_ID_MESSAGE = 'instructorId має бути UUID.';
const CAR_ID_MESSAGE = 'carId має бути UUID.';

const DURATION_DESCRIPTION = `Тривалість у хвилинах, ціле число від ${LESSON_MIN_DURATION_MIN} до ${LESSON_MAX_DURATION_MIN}.`;

const SCHEDULED_AT_DESCRIPTION =
  'Початок слоту, ISO 8601 з часовим зсувом (Z або ±HH:MM). Має бути в майбутньому і на початку хвилини (секунди 00).';

/** Необов'язковий початок слоту: той самий формат, що IsScheduledAt; null відхиляється. */
function IsOptionalScheduledAt() {
  return applyDecorators(
    IsISO8601({ strict: true }, { message: SCHEDULED_AT_FORMAT_MESSAGE }),
    Matches(ZONED_DATE_TIME_PATTERN, { message: SCHEDULED_AT_FORMAT_MESSAGE }),
    IsString({ message: SCHEDULED_AT_FORMAT_MESSAGE }),
    ValidateIf((_, value) => value !== undefined),
  );
}

export class CreatePracticeSlotDto {
  @ApiProperty({
    format: 'uuid',
    example: '5b0c0000-0000-4000-8000-000000000000',
    description:
      'Інструктор слоту: INSTRUCTOR зі статусом ACTIVE своєї автошколи.',
  })
  @IsUUID('4', { message: INSTRUCTOR_ID_MESSAGE })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  instructorId: string;

  @ApiProperty({
    format: 'uuid',
    example: 'c7d20000-0000-4000-8000-000000000000',
    description: 'Авто слоту: AVAILABLE і закріплене за інструктором слоту.',
  })
  @IsUUID('4', { message: CAR_ID_MESSAGE })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  carId: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-11-16T10:00:00+02:00',
    description: SCHEDULED_AT_DESCRIPTION,
  })
  @IsScheduledAt()
  scheduledAt: string;

  @ApiPropertyOptional({
    example: PRACTICE_DEFAULT_DURATION_MIN,
    default: PRACTICE_DEFAULT_DURATION_MIN,
    minimum: LESSON_MIN_DURATION_MIN,
    maximum: LESSON_MAX_DURATION_MIN,
    description: DURATION_DESCRIPTION,
  })
  @IsLessonDuration()
  durationMin?: number;
}

/** Усі поля необов'язкові, але хоча б одне потрібне: порожнє тіло відхиляє сервіс. */
export class UpdatePracticeSlotDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Новий інструктор. Без нового carId авто слоту має бути закріплене і за ним.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID('4', { message: INSTRUCTOR_ID_MESSAGE })
  instructorId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Нове авто: AVAILABLE і закріплене за інструктором слоту.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID('4', { message: CAR_ID_MESSAGE })
  carId?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-11-16T12:00:00+02:00',
    description: SCHEDULED_AT_DESCRIPTION,
  })
  @IsOptionalScheduledAt()
  scheduledAt?: string;

  @ApiPropertyOptional({
    example: 90,
    minimum: LESSON_MIN_DURATION_MIN,
    maximum: LESSON_MAX_DURATION_MIN,
    description: DURATION_DESCRIPTION,
  })
  @IsLessonDuration()
  durationMin?: number;
}

/** Організація береться з access token: organizationId тут немає. */
export class PracticeSlotListQueryDto {
  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-11-16T00:00:00+02:00',
    description:
      'Початок вікна, ISO 8601 з часовим зсувом (Z або ±HH:MM). За замовчуванням — поточний момент. ' +
      'Знак + кодуйте як %2B, інакше він прийде пробілом.',
  })
  @IsScheduleBoundary()
  from?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-11-23T00:00:00+02:00',
    description:
      `Кінець вікна, не включно. За замовчуванням — from + ${SCHEDULE_DEFAULT_RANGE_DAYS} днів. ` +
      `Має бути пізніше за from, але не більше ніж на ${SCHEDULE_MAX_RANGE_DAYS} днів.`,
  })
  @IsScheduleBoundary()
  to?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Лише слоти цього інструктора. INSTRUCTOR може передати тільки свій id.',
  })
  @IsUUID('4', { message: INSTRUCTOR_ID_MESSAGE })
  @IsOptional()
  instructorId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Лише слоти цього авто.',
  })
  @IsUUID('4', { message: CAR_ID_MESSAGE })
  @IsOptional()
  carId?: string;
}

/**
 * Query списку доступних слотів. Окремий клас, а не PracticeSlotListQueryDto:
 * студент не передає instructorId чи carId, forbidNonWhitelisted дасть 400.
 */
export class AvailablePracticeSlotQueryDto {
  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-11-16T00:00:00+02:00',
    description:
      'Початок вікна, ISO 8601 з часовим зсувом (Z або ±HH:MM). За замовчуванням — поточний момент. ' +
      'Слоти, що вже почалися, не повертаються. Знак + кодуйте як %2B, інакше він прийде пробілом.',
  })
  @IsScheduleBoundary()
  from?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-11-23T00:00:00+02:00',
    description:
      `Кінець вікна, не включно. За замовчуванням — from + ${SCHEDULE_DEFAULT_RANGE_DAYS} днів. ` +
      `Має бути пізніше за from, але не більше ніж на ${SCHEDULE_MAX_RANGE_DAYS} днів.`,
  })
  @IsScheduleBoundary()
  to?: string;
}

export class PracticeSlotDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: '2026-11-16T08:00:00.000Z' })
  scheduledAt: Date;

  @ApiProperty({
    example: '2026-11-16T09:00:00.000Z',
    description: 'scheduledAt + durationMin.',
  })
  endsAt: Date;

  @ApiProperty({ example: 60 })
  durationMin: number;

  @ApiProperty({ type: LessonPersonDto })
  instructor: LessonPersonDto;

  @ApiProperty({ type: LessonCarDto })
  car: LessonCarDto;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class PracticeSlotListDto {
  @ApiProperty({
    example: '2026-11-15T22:00:00.000Z',
    description: 'Фактичний початок вікна після значень за замовчуванням.',
  })
  from: Date;

  @ApiProperty({
    example: '2026-11-22T22:00:00.000Z',
    description: 'Фактичний кінець вікна, не включно.',
  })
  to: Date;

  @ApiProperty({
    example: 'Europe/Kyiv',
    description: 'Часовий пояс автошколи: показуйте час слоту в ньому.',
  })
  timezone: string;

  @ApiProperty({
    type: [PracticeSlotDto],
    description:
      'Слоти за зростанням scheduledAt. Загальний список — слоти, що перетинають вікно [from, to); ' +
      'список доступних — вільні слоти, що починаються у вікні й у майбутньому.',
  })
  items: PracticeSlotDto[];
}
