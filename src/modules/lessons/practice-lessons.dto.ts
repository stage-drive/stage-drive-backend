import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingConfirmation, LessonStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsEnum,
  IsIn,
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
  INSTRUCTOR_COMMENT_MAX_LENGTH,
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

export const INSTRUCTOR_COMMENT_LENGTH_MESSAGE = `Коментар має містити не більше ${INSTRUCTOR_COMMENT_MAX_LENGTH} символів.`;
export const INSTRUCTOR_COMMENT_TYPE_MESSAGE = 'comment має бути рядком.';
export const STUDENT_ID_MESSAGE = 'studentId має бути UUID.';

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

const COMMENT_DESCRIPTION =
  `Коментар інструктора, до ${INSTRUCTOR_COMMENT_MAX_LENGTH} символів; бачить і студент. ` +
  'Пробіли по краях обрізаються.';

/** Результат заняття, який фіксує інструктор чи ADMIN. */
export const PRACTICE_OUTCOME_RESULTS = [
  LessonStatus.COMPLETED,
  LessonStatus.NO_SHOW,
] as const;
export type PracticeOutcomeResult = (typeof PRACTICE_OUTCOME_RESULTS)[number];
export const OUTCOME_RESULT_MESSAGE = 'result має бути COMPLETED або NO_SHOW.';

/**
 * Тіло результату заняття: «проведено» чи «неявка». Коментар необов'язковий;
 * без нього попередній коментар лишається.
 */
export class PracticeLessonOutcomeDto {
  @ApiProperty({
    enum: PRACTICE_OUTCOME_RESULTS,
    example: LessonStatus.COMPLETED,
    description: 'COMPLETED — заняття відбулося, NO_SHOW — студент не прийшов.',
  })
  @IsIn(PRACTICE_OUTCOME_RESULTS, { message: OUTCOME_RESULT_MESSAGE })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  result: PracticeOutcomeResult;

  @ApiPropertyOptional({
    example: 'Добре тримає дистанцію; потренувати паркування.',
    maxLength: INSTRUCTOR_COMMENT_MAX_LENGTH,
    description: COMMENT_DESCRIPTION,
  })
  @Transform(trimString)
  @ValidateIf((_, value) => value !== undefined)
  @IsPlainText()
  @MaxLength(INSTRUCTOR_COMMENT_MAX_LENGTH, {
    message: INSTRUCTOR_COMMENT_LENGTH_MESSAGE,
  })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: INSTRUCTOR_COMMENT_TYPE_MESSAGE })
  comment?: string;
}

export class UpdatePracticeCommentDto {
  @ApiProperty({
    example: 'Наступного разу — міський маршрут.',
    maxLength: INSTRUCTOR_COMMENT_MAX_LENGTH,
    description: `${COMMENT_DESCRIPTION} Замінює попередній коментар.`,
  })
  @Transform(trimString)
  @IsPlainText()
  @MaxLength(INSTRUCTOR_COMMENT_MAX_LENGTH, {
    message: INSTRUCTOR_COMMENT_LENGTH_MESSAGE,
  })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: INSTRUCTOR_COMMENT_TYPE_MESSAGE })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  comment: string;
}

/** STUDENT — без studentId (свій прогрес); ADMIN — studentId обов'язковий. */
export class PracticeProgressQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Студент (id користувача). Обов’язковий для ADMIN; STUDENT може не передавати або передати лише свій id.',
  })
  @IsUUID('4', { message: STUDENT_ID_MESSAGE })
  @IsOptional()
  studentId?: string;
}

export class PracticeProgressDto {
  @ApiProperty({ format: 'uuid' })
  studentId: string;

  @ApiProperty({ example: 6, description: 'Проведені заняття (COMPLETED).' })
  completedLessons: number;

  @ApiProperty({
    example: 720,
    description: 'Сумарна тривалість проведених занять, хвилин.',
  })
  completedMinutes: number;

  @ApiProperty({ example: 1, description: 'Неявки (NO_SHOW).' })
  noShows: number;

  @ApiProperty({
    example: 2,
    description:
      'Скасовані заняття (студентом, інструктором чи ADMIN), без відхилених запитів на бронювання.',
  })
  cancelled: number;

  @ApiProperty({
    example: 1,
    description:
      'Заплановані заняття, що ще не закінчилися: і ті, що чекають підтвердження, і підтверджені.',
  })
  upcoming: number;

  @ApiProperty({
    example: 0,
    description:
      'Підтверджені заняття, що вже закінчилися, але результат (проведено чи неявка) ще не зафіксовано.',
  })
  awaitingOutcome: number;

  @ApiProperty({
    type: Date,
    nullable: true,
    example: '2026-11-12T08:00:00.000Z',
    description:
      'Початок останнього проведеного заняття; null, якщо таких немає.',
  })
  lastCompletedAt: Date | null;
}
