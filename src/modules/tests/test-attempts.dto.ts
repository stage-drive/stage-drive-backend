import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  TheoryTestAttemptStatus,
  TheoryTestFormat,
  TheoryTestStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsDefined, IsUUID, ValidateNested } from 'class-validator';
import { REQUIRED_FIELD_MESSAGE } from '../courses/courses.dto';
import { NextAttemptBlockReason } from './test-attempts.rules';

export const ANSWERS_ARRAY_MESSAGE = 'answers має бути масивом відповідей.';
export const QUESTION_ID_MESSAGE = 'questionId має бути UUID.';
export const OPTION_IDS_MESSAGE = 'optionIds має бути масивом UUID.';

export class AttemptOptionDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Id варіанта тесту на момент старту спроби.',
  })
  id: string;

  @ApiProperty({ example: 'Поступитися дорогою' })
  text: string;

  @ApiProperty({ example: 1, minimum: 1 })
  position: number;

  @ApiPropertyOptional({
    example: true,
    description:
      'Є лише після перевірки спроби (PASSED або FAILED). До завершення і після EXPIRED поле не повертається.',
  })
  isCorrect?: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      'Чи студент обрав цей варіант. Є лише після перевірки (PASSED або FAILED).',
  })
  selected?: boolean;
}

export class AttemptQuestionDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Id питання тесту на момент старту. Саме його треба надіслати в submit.',
  })
  id: string;

  @ApiProperty({ example: 'Що означає цей знак?' })
  text: string;

  @ApiProperty({
    example: 1,
    minimum: 1,
    description: 'Порядок показу в цій спробі, з 1.',
  })
  position: number;

  @ApiProperty({ type: [AttemptOptionDto] })
  options: AttemptOptionDto[];
}

export class AttemptDetailDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  testId: string;

  @ApiProperty({ format: 'uuid' })
  courseId: string;

  @ApiProperty({ format: 'uuid' })
  studentId: string;

  @ApiProperty({
    enum: TheoryTestAttemptStatus,
    example: TheoryTestAttemptStatus.IN_PROGRESS,
  })
  status: TheoryTestAttemptStatus;

  @ApiProperty({
    enum: TheoryTestFormat,
    example: TheoryTestFormat.SINGLE_CHOICE,
  })
  format: TheoryTestFormat;

  @ApiProperty({ description: 'Час старту за годинником сервера.' })
  startedAt: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Дедлайн сервера. null — тест без ліміту. Клієнтський таймер цей момент не подовжує.',
  })
  expiresAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  submittedAt: Date | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: null,
    description:
      'Відсоток правильних відповідей після перевірки. null, доки спроба IN_PROGRESS або EXPIRED.',
  })
  score: number | null;

  @ApiProperty({ example: 90, minimum: 1, maximum: 100 })
  passingScore: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 20,
    description: 'Ліміт у хвилинах, знятий на старті. null — без обмеження.',
  })
  timeLimitMinutes: number | null;

  @ApiProperty({ type: [AttemptQuestionDto] })
  questions: AttemptQuestionDto[];

  @ApiPropertyOptional({
    example: 'Пройдіть урок ще раз.',
    description:
      'Є після провалу тесту уроку і коли спроби цього тесту вичерпано. Студент має пройти урок знову.',
  })
  message?: string;
}

export class AttemptConflictDto {
  @ApiProperty({ example: 409 })
  statusCode: number;

  @ApiProperty({
    example: 'У вас уже є незавершена спроба цього тесту.',
  })
  message: string;

  @ApiProperty({
    enum: NextAttemptBlockReason,
    example: NextAttemptBlockReason.IN_PROGRESS,
    description:
      'IN_PROGRESS — треба продовжити відкриту спробу. ALREADY_PASSED — тест складено. ATTEMPTS_EXHAUSTED — ліміт спроб вичерпано. LESSON_NOT_COMPLETED — урок тесту ще не пройдено, повідомлення «Пройдіть урок ще раз.».',
  })
  reason: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Id уже відкритої спроби. Є лише коли reason = IN_PROGRESS.',
  })
  attemptId?: string;
}

export class TestScoreDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Спроба, з якої пораховано цей результат.',
  })
  attemptId: string;

  @ApiProperty({ enum: TheoryTestStatus, example: TheoryTestStatus.PASSED })
  status: TheoryTestStatus;

  @ApiProperty({
    example: 100,
    minimum: 0,
    maximum: 100,
    description:
      'Відсоток правильних відповідей. Поріг — passingScore цієї спроби.',
  })
  score: number;

  @ApiProperty({
    example: 90,
    description: 'Поріг, з яким порівнювали цю спробу.',
  })
  passingScore: number;

  @ApiProperty({ type: String, format: 'date-time' })
  submittedAt: Date;
}

export class TestOutcomeDto {
  @ApiProperty({ format: 'uuid' })
  testId: string;

  @ApiProperty({ format: 'uuid' })
  courseId: string;

  @ApiProperty({ format: 'uuid' })
  studentId: string;

  @ApiProperty({
    example: 90,
    description: 'Поточний поріг у налаштуваннях тесту.',
  })
  passingScore: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 3,
    description: 'Поточний ліміт спроб. null — без обмеження кількості.',
  })
  maxAttempts: number | null;

  @ApiProperty({
    example: 1,
    description:
      'Скільки спроб уже витрачено: PASSED, FAILED і EXPIRED. Відкрита спроба сюди не входить.',
  })
  attemptsUsed: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 2,
    description:
      'Скільки нових стартів ще можна зробити після поточної відкритої спроби. null — кількості немає.',
  })
  attemptsRemaining: number | null;

  @ApiProperty({ example: true })
  nextAttemptAvailable: boolean;

  @ApiProperty({
    enum: NextAttemptBlockReason,
    nullable: true,
    example: null,
    description: 'Чому наступну спробу почати не можна. null — можна.',
  })
  unavailableReason: NextAttemptBlockReason | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Відкрита спроба, яку треба продовжити. null — такої немає.',
  })
  openAttemptId: string | null;

  @ApiProperty({
    type: TestScoreDto,
    nullable: true,
    description:
      'Останній перевірений результат цього студента і цього тесту. null — ще не було PASSED або FAILED. Правильні відповіді тут не повертаються.',
  })
  result: TestScoreDto | null;
}

export class StaffAttemptSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: TheoryTestAttemptStatus })
  status: TheoryTestAttemptStatus;

  @ApiProperty({ type: Number, nullable: true, example: 80 })
  score: number | null;

  @ApiProperty({ example: 90 })
  passingScore: number;

  @ApiProperty({ type: String, format: 'date-time' })
  startedAt: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  submittedAt: Date | null;
}

export class StaffTestResultDto extends TestOutcomeDto {
  @ApiProperty({ example: 'Олена' })
  firstName: string;

  @ApiProperty({ example: 'Коваль' })
  lastName: string;

  @ApiProperty({
    type: [StaffAttemptSummaryDto],
    description:
      'Усі спроби цього студента і цього тесту, від новішої. Питання і isCorrect не входять.',
  })
  attempts: StaffAttemptSummaryDto[];
}

export class StaffTestResultListDto {
  @ApiProperty({ type: [StaffTestResultDto] })
  results: StaffTestResultDto[];
}

export class SubmitAttemptAnswerDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Id питання з відповіді спроби, не з нового каталогу тесту.',
  })
  @IsUUID('4', { message: QUESTION_ID_MESSAGE })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  questionId: string;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      'Обрані варіанти цього питання. Порожній масив лишає питання без відповіді.',
  })
  @IsUUID('4', { each: true, message: OPTION_IDS_MESSAGE })
  @IsArray({ message: OPTION_IDS_MESSAGE })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  optionIds: string[];
}

export class SubmitAttemptDto {
  @ApiProperty({ type: [SubmitAttemptAnswerDto] })
  @ValidateNested({ each: true })
  @Type(() => SubmitAttemptAnswerDto)
  @IsArray({ message: ANSWERS_ARRAY_MESSAGE })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  answers: SubmitAttemptAnswerDto[];
}
