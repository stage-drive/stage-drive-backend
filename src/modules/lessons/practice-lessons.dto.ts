import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingConfirmation } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { IsPlainText } from '../../common/validators/plain-text.decorator';
import { PRACTICE_BOOKING_DURATION_MIN } from './availability';
import {
  INCLUDE_CANCELLED_MESSAGE,
  IsScheduleBoundary,
  IsScheduledAt,
  LessonCarDto,
  LessonPersonDto,
  MEETING_PLACE_LENGTH_MESSAGE,
  MEETING_PLACE_MAX_LENGTH,
  MEETING_PLACE_TYPE_MESSAGE,
  PracticeLessonDto,
  REQUIRED_FIELD_MESSAGE,
  SCHEDULE_DEFAULT_RANGE_DAYS,
  SCHEDULE_MAX_RANGE_DAYS,
  optionalBoolean,
  trimString,
} from './lessons.dto';

const FROM_DESCRIPTION =
  'Початок вікна, ISO 8601 з часовим зсувом (Z або ±HH:MM). За замовчуванням — поточний момент. ' +
  'Знак + кодуйте як %2B, інакше він прийде пробілом.';

const TO_DESCRIPTION =
  `Кінець вікна, не включно. За замовчуванням — from + ${SCHEDULE_DEFAULT_RANGE_DAYS} днів. ` +
  `Має бути пізніше за from, але не більше ніж на ${SCHEDULE_MAX_RANGE_DAYS} днів.`;

export const CONFIRMATION_STATUS_MESSAGE =
  'confirmationStatus має бути PENDING, CONFIRMED або REJECTED.';

/** Список практичних занять: ADMIN — автошколи, INSTRUCTOR — свої. Організація — з access token. */
export class PracticeLessonListQueryDto {
  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-11-16T00:00:00+02:00',
    description: FROM_DESCRIPTION,
  })
  @IsScheduleBoundary()
  from?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-11-23T00:00:00+02:00',
    description: TO_DESCRIPTION,
  })
  @IsScheduleBoundary()
  to?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Лише заняття цього інструктора. INSTRUCTOR може передати тільки свій id (без нього — і так лише свої).',
  })
  @IsUUID('4', { message: 'instructorId має бути UUID.' })
  @IsOptional()
  instructorId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Лише заняття цього студента (id користувача).',
  })
  @IsUUID('4', { message: 'studentId має бути UUID.' })
  @IsOptional()
  studentId?: string;

  @ApiPropertyOptional({
    type: Boolean,
    default: false,
    description: 'true — повернути й скасовані заняття.',
  })
  @Transform(optionalBoolean)
  @IsBoolean({ message: INCLUDE_CANCELLED_MESSAGE })
  @IsOptional()
  includeCancelled?: boolean;

  @ApiPropertyOptional({
    enum: BookingConfirmation,
    description:
      'Лише заняття з цим підтвердженням. PENDING — запити, що чекають відповіді інструктора. ' +
      'REJECTED — скасовані, тож потрібен і includeCancelled=true.',
  })
  @IsEnum(BookingConfirmation, { message: CONFIRMATION_STATUS_MESSAGE })
  @IsOptional()
  confirmationStatus?: BookingConfirmation;
}

export class PracticeLessonListDto {
  @ApiProperty({ example: '2026-11-15T22:00:00.000Z' })
  from: Date;

  @ApiProperty({ example: '2026-11-22T22:00:00.000Z' })
  to: Date;

  @ApiProperty({
    example: 'Europe/Kyiv',
    description: 'Часовий пояс автошколи: показуйте час занять у ньому.',
  })
  timezone: string;

  @ApiProperty({
    type: [PracticeLessonDto],
    description:
      'Заняття, що перетинають вікно [from, to), за зростанням scheduledAt.',
  })
  items: PracticeLessonDto[];
}

/**
 * Вільні слоти студента. Студент не передає instructorId чи carId: вони беруться
 * з його профілю практики, а forbidNonWhitelisted дасть 400.
 */
export class AvailablePracticeSlotQueryDto {
  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-11-16T00:00:00+02:00',
    description: `${FROM_DESCRIPTION} Слоти, що вже почалися, не повертаються.`,
  })
  @IsScheduleBoundary()
  from?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-11-23T00:00:00+02:00',
    description: TO_DESCRIPTION,
  })
  @IsScheduleBoundary()
  to?: string;
}

export class AvailablePracticeSlotDto {
  @ApiProperty({ example: '2026-11-16T07:00:00.000Z' })
  scheduledAt: Date;

  @ApiProperty({
    example: '2026-11-16T09:00:00.000Z',
    description: 'scheduledAt + durationMin.',
  })
  endsAt: Date;

  @ApiProperty({ example: PRACTICE_BOOKING_DURATION_MIN })
  durationMin: number;

  @ApiProperty({ type: LessonPersonDto })
  instructor: LessonPersonDto;

  @ApiProperty({ type: LessonCarDto })
  car: LessonCarDto;
}

export class ActivePracticeLessonDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: '2026-11-18T07:00:00.000Z' })
  scheduledAt: Date;

  @ApiProperty({ example: '2026-11-18T09:00:00.000Z' })
  endsAt: Date;
}

export class AvailablePracticeSlotListDto {
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
    description: 'Часовий пояс автошколи: показуйте час слотів у ньому.',
  })
  timezone: string;

  @ApiProperty({
    example: PRACTICE_BOOKING_DURATION_MIN,
    description: 'Тривалість заняття, яке бронює студент.',
  })
  durationMin: number;

  @ApiProperty({
    type: ActivePracticeLessonDto,
    nullable: true,
    description:
      'Заплановане заняття студента, що ще не закінчилося. Поки воно є, нове забронювати не можна (409): ' +
      'покажіть його й запропонуйте скасувати, щоб вибрати інший час.',
  })
  activeLesson: ActivePracticeLessonDto | null;

  @ApiProperty({
    type: [AvailablePracticeSlotDto],
    description:
      'Вільні слоти за зростанням scheduledAt: починаються у вікні й у майбутньому.',
  })
  items: AvailablePracticeSlotDto[];
}

export class BookPracticeLessonDto {
  @ApiProperty({
    format: 'date-time',
    example: '2026-11-16T09:00:00+02:00',
    description:
      'Початок одного з вільних слотів (GET /lessons/practice/available), ISO 8601 з часовим зсувом.',
  })
  @IsScheduledAt()
  scheduledAt: string;

  @ApiPropertyOptional({
    example: 'Біля офісу автошколи',
    maxLength: MEETING_PLACE_MAX_LENGTH,
    description:
      'Необов’язкове місце зустрічі. Без нього інструктор задасть місце пізніше. Пробіли по краях обрізаються.',
  })
  @Transform(trimString)
  @ValidateIf((_, value) => value !== undefined)
  @IsPlainText()
  @MaxLength(MEETING_PLACE_MAX_LENGTH, {
    message: MEETING_PLACE_LENGTH_MESSAGE,
  })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: MEETING_PLACE_TYPE_MESSAGE })
  meetingPlace?: string;
}
