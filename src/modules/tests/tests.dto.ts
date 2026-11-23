import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { TheoryTestFormat, TheoryTestPublicationStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsPlainText } from '../../common/validators/plain-text.decorator';
import {
  COURSE_DESCRIPTION_LENGTH_MESSAGE,
  COURSE_DESCRIPTION_MAX_LENGTH,
  REQUIRED_FIELD_MESSAGE,
} from '../courses/courses.dto';

export const TEST_NAME_MAX_LENGTH = 200;
export const QUESTION_TEXT_MAX_LENGTH = 2000;
export const OPTION_TEXT_MAX_LENGTH = 500;
export const PASSING_SCORE_MIN = 1;
export const PASSING_SCORE_MAX = 100;
export const TIME_LIMIT_MIN = 1;
export const TIME_LIMIT_MAX = 240;
export const MAX_ATTEMPTS_MIN = 1;
export const MAX_ATTEMPTS_MAX = 20;

export const TEST_NAME_LENGTH_MESSAGE = `Назва має містити не більше ${TEST_NAME_MAX_LENGTH} символів.`;
export const QUESTION_TEXT_LENGTH_MESSAGE = `Текст питання має містити не більше ${QUESTION_TEXT_MAX_LENGTH} символів.`;
export const OPTION_TEXT_LENGTH_MESSAGE = `Текст варіанта має містити не більше ${OPTION_TEXT_MAX_LENGTH} символів.`;
export const TEST_FORMAT_MESSAGE =
  'format має бути SINGLE_CHOICE, MULTIPLE_CHOICE або TRUE_FALSE.';
export const TEST_PUBLICATION_MESSAGE =
  'publicationStatus має бути DRAFT або PUBLISHED.';
export const PASSING_SCORE_MESSAGE = `passingScore має бути цілим числом від ${PASSING_SCORE_MIN} до ${PASSING_SCORE_MAX}.`;
export const TIME_LIMIT_MESSAGE = `timeLimitMinutes має бути цілим числом від ${TIME_LIMIT_MIN} до ${TIME_LIMIT_MAX} або null.`;
export const MAX_ATTEMPTS_MESSAGE = `maxAttempts має бути цілим числом від ${MAX_ATTEMPTS_MIN} до ${MAX_ATTEMPTS_MAX} або null.`;
export const SHUFFLE_MESSAGE = 'shuffleQuestions має бути true або false.';
export const COURSE_ID_MESSAGE = 'courseId має бути UUID.';
export const OPTIONS_ARRAY_MESSAGE = 'options має бути масивом варіантів.';
export const POSITION_INTEGER_MESSAGE = 'position має бути цілим числом.';
export const POSITION_MIN_MESSAGE = 'position має бути не менше 1.';
export const CORRECT_FLAG_MESSAGE = 'isCorrect має бути true або false.';

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function emptyToNull({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function integerValue({ value }: { value: unknown }): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return Number(value.trim());
  }
  return value;
}

export class AnswerOptionDto {
  @ApiProperty({ example: '81818181-8181-4818-8818-818181818181' })
  id: string;

  @ApiProperty({ example: '71717171-7171-4717-8717-717171717171' })
  questionId: string;

  @ApiProperty({ example: 'Поступитися дорогою' })
  text: string;

  @ApiProperty({
    example: true,
    description:
      'Чи цей варіант є правильною відповіддю. Для SINGLE_CHOICE і TRUE_FALSE істинною може бути лише одна позначка в питанні.',
  })
  isCorrect: boolean;

  @ApiProperty({ example: 1, minimum: 1 })
  position: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class QuestionDto {
  @ApiProperty({ example: '71717171-7171-4717-8717-717171717171' })
  id: string;

  @ApiProperty({ example: '61616161-6161-4616-8616-616161616161' })
  testId: string;

  @ApiProperty({ example: 'Що означає цей знак?' })
  text: string;

  @ApiProperty({ example: 1, minimum: 1 })
  position: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ type: [AnswerOptionDto] })
  options: AnswerOptionDto[];
}

export class TestDto {
  @ApiProperty({ example: '61616161-6161-4616-8616-616161616161' })
  id: string;

  @ApiProperty({ example: '41414141-4141-4414-8414-414141414141' })
  courseId: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Урок, до якого прив’язаний тест. null — тест усього курсу. У тесту уроку рівно 3 спроби.',
  })
  courseLessonId: string | null;

  @ApiProperty({ example: 'ПДР, категорія B' })
  name: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Підсумковий тест теоретичного курсу.',
  })
  description: string | null;

  @ApiProperty({
    enum: TheoryTestFormat,
    example: TheoryTestFormat.SINGLE_CHOICE,
    description:
      'SINGLE_CHOICE — одна правильна відповідь. MULTIPLE_CHOICE — кілька. TRUE_FALSE — так/ні.',
  })
  format: TheoryTestFormat;

  @ApiProperty({
    example: 90,
    minimum: PASSING_SCORE_MIN,
    maximum: PASSING_SCORE_MAX,
    description: 'Поріг складання у відсотках.',
  })
  passingScore: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 20,
    description: 'Ліміт часу в хвилинах. null — без обмеження.',
  })
  timeLimitMinutes: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 3,
    minimum: MAX_ATTEMPTS_MIN,
    maximum: MAX_ATTEMPTS_MAX,
    description:
      'Скільки спроб можна витратити. null — без обмеження. Після PASSED нова спроба не відкривається.',
  })
  maxAttempts: number | null;

  @ApiProperty({ example: false })
  shuffleQuestions: boolean;

  @ApiProperty({
    enum: TheoryTestPublicationStatus,
    example: TheoryTestPublicationStatus.DRAFT,
    description:
      'Новий тест завжди DRAFT. PUBLISHED ставиться лише PATCH /tests/{testId}/publication після перевірки структури.',
  })
  publicationStatus: TheoryTestPublicationStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class TestListItemDto extends TestDto {
  @ApiProperty({ example: 20, description: 'Кількість питань тесту.' })
  questionCount: number;
}

export class TestListDto {
  @ApiProperty({ type: [TestListItemDto] })
  tests: TestListItemDto[];
}

export class TestDetailDto extends TestDto {
  @ApiProperty({
    type: [QuestionDto],
    description:
      'Питання за position від 1. У кожному — варіанти і позначка правильної відповіді. Це відповідь ADMIN.',
  })
  questions: QuestionDto[];
}

export class StudentAnswerOptionDto {
  @ApiProperty({ example: '81818181-8181-4818-8818-818181818181' })
  id: string;

  @ApiProperty({ example: '71717171-7171-4717-8717-717171717171' })
  questionId: string;

  @ApiProperty({ example: 'Поступитися дорогою' })
  text: string;

  @ApiProperty({ example: 1, minimum: 1 })
  position: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class StudentQuestionDto {
  @ApiProperty({ example: '71717171-7171-4717-8717-717171717171' })
  id: string;

  @ApiProperty({ example: '61616161-6161-4616-8616-616161616161' })
  testId: string;

  @ApiProperty({ example: 'Що означає цей знак?' })
  text: string;

  @ApiProperty({ example: 1, minimum: 1 })
  position: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({
    type: [StudentAnswerOptionDto],
    description:
      'Варіанти без isCorrect. Правильну відповідь студент не отримує до завершення спроби.',
  })
  options: StudentAnswerOptionDto[];
}

export class StudentTestDetailDto extends TestDto {
  @ApiProperty({
    type: [StudentQuestionDto],
    description:
      'Питання опублікованого тесту за position. Позначки правильних відповідей у відповіді немає.',
  })
  questions: StudentQuestionDto[];
}

export class StudentTestListDto {
  @ApiProperty({
    example: '41414141-4141-4414-8414-414141414141',
    description:
      'Курс групи, у якій у студента активне зарахування. Тести іншого курсу сюди не потрапляють.',
  })
  courseId: string;

  @ApiProperty({
    type: [TestListItemDto],
    description:
      'Лише тести зі збереженим publicationStatus PUBLISHED. Чернетки не повертаються.',
  })
  tests: TestListItemDto[];
}

export class AnswerOptionInputDto {
  @ApiProperty({
    example: 'Поступитися дорогою',
    maxLength: OPTION_TEXT_MAX_LENGTH,
  })
  @Transform(trimString)
  @IsPlainText()
  @MaxLength(OPTION_TEXT_MAX_LENGTH, { message: OPTION_TEXT_LENGTH_MESSAGE })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'text має бути рядком.' })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  text: string;

  @ApiProperty({ example: false })
  @IsBoolean({ message: CORRECT_FLAG_MESSAGE })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  isCorrect: boolean;
}

export class CreateTestDto {
  @ApiProperty({
    example: '41414141-4141-4414-8414-414141414141',
    description: 'Курс своєї автошколи. Курс іншої організації дає 404.',
  })
  @IsUUID('4', { message: COURSE_ID_MESSAGE })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  courseId: string;

  @ApiProperty({ example: 'ПДР, категорія B', maxLength: TEST_NAME_MAX_LENGTH })
  @Transform(trimString)
  @IsPlainText()
  @MaxLength(TEST_NAME_MAX_LENGTH, { message: TEST_NAME_LENGTH_MESSAGE })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'name має бути рядком.' })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  name: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: COURSE_DESCRIPTION_MAX_LENGTH,
    example: 'Підсумковий тест теоретичного курсу.',
    description: 'Порожній рядок зберігається як null.',
  })
  @Transform(emptyToNull)
  @IsOptional()
  @IsPlainText()
  @MaxLength(COURSE_DESCRIPTION_MAX_LENGTH, {
    message: COURSE_DESCRIPTION_LENGTH_MESSAGE,
  })
  @IsString({ message: 'description має бути рядком або null.' })
  description?: string | null;

  @ApiProperty({
    enum: TheoryTestFormat,
    example: TheoryTestFormat.SINGLE_CHOICE,
  })
  @IsEnum(TheoryTestFormat, { message: TEST_FORMAT_MESSAGE })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  format: TheoryTestFormat;

  @ApiProperty({
    example: 90,
    minimum: PASSING_SCORE_MIN,
    maximum: PASSING_SCORE_MAX,
  })
  @Transform(integerValue)
  @Min(PASSING_SCORE_MIN, { message: PASSING_SCORE_MESSAGE })
  @Max(PASSING_SCORE_MAX, { message: PASSING_SCORE_MESSAGE })
  @IsInt({ message: PASSING_SCORE_MESSAGE })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  passingScore: number;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 20,
    minimum: TIME_LIMIT_MIN,
    maximum: TIME_LIMIT_MAX,
    description: 'Хвилини. null або пропуск — без обмеження часу.',
  })
  @Transform(integerValue)
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @Min(TIME_LIMIT_MIN, { message: TIME_LIMIT_MESSAGE })
  @Max(TIME_LIMIT_MAX, { message: TIME_LIMIT_MESSAGE })
  @IsInt({ message: TIME_LIMIT_MESSAGE })
  timeLimitMinutes?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 3,
    minimum: MAX_ATTEMPTS_MIN,
    maximum: MAX_ATTEMPTS_MAX,
    description:
      'Скільки спроб можна витратити. null або пропуск — без обмеження кількості.',
  })
  @Transform(integerValue)
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @Min(MAX_ATTEMPTS_MIN, { message: MAX_ATTEMPTS_MESSAGE })
  @Max(MAX_ATTEMPTS_MAX, { message: MAX_ATTEMPTS_MESSAGE })
  @IsInt({ message: MAX_ATTEMPTS_MESSAGE })
  maxAttempts?: number | null;

  @ApiPropertyOptional({ example: false, default: false })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean({ message: SHUFFLE_MESSAGE })
  shuffleQuestions?: boolean;
}

/** Тест уроку. courseId береться з адреси, maxAttempts завжди 3. */
export class CreateLessonTestDto extends OmitType(CreateTestDto, [
  'courseId',
  'maxAttempts',
] as const) {}

export class UpdateTestDto {
  @ApiPropertyOptional({ example: '41414141-4141-4414-8414-414141414141' })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID('4', { message: COURSE_ID_MESSAGE })
  courseId?: string;

  @ApiPropertyOptional({ example: 'ПДР, категорія B (вечірня)' })
  @Transform(trimString)
  @ValidateIf((_, value) => value !== undefined)
  @IsPlainText()
  @MaxLength(TEST_NAME_MAX_LENGTH, { message: TEST_NAME_LENGTH_MESSAGE })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'name має бути рядком.' })
  name?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'null або порожній рядок очищає опис.',
  })
  @Transform(emptyToNull)
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsPlainText()
  @MaxLength(COURSE_DESCRIPTION_MAX_LENGTH, {
    message: COURSE_DESCRIPTION_LENGTH_MESSAGE,
  })
  @IsString({ message: 'description має бути рядком або null.' })
  description?: string | null;

  @ApiPropertyOptional({ enum: TheoryTestFormat })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(TheoryTestFormat, { message: TEST_FORMAT_MESSAGE })
  format?: TheoryTestFormat;

  @ApiPropertyOptional({ example: 80 })
  @Transform(integerValue)
  @ValidateIf((_, value) => value !== undefined)
  @Min(PASSING_SCORE_MIN, { message: PASSING_SCORE_MESSAGE })
  @Max(PASSING_SCORE_MAX, { message: PASSING_SCORE_MESSAGE })
  @IsInt({ message: PASSING_SCORE_MESSAGE })
  passingScore?: number;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'null знімає ліміт часу.',
  })
  @Transform(integerValue)
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @Min(TIME_LIMIT_MIN, { message: TIME_LIMIT_MESSAGE })
  @Max(TIME_LIMIT_MAX, { message: TIME_LIMIT_MESSAGE })
  @IsInt({ message: TIME_LIMIT_MESSAGE })
  timeLimitMinutes?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'null знімає обмеження кількості спроб.',
  })
  @Transform(integerValue)
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @Min(MAX_ATTEMPTS_MIN, { message: MAX_ATTEMPTS_MESSAGE })
  @Max(MAX_ATTEMPTS_MAX, { message: MAX_ATTEMPTS_MESSAGE })
  @IsInt({ message: MAX_ATTEMPTS_MESSAGE })
  maxAttempts?: number | null;

  @ApiPropertyOptional({ example: true })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean({ message: SHUFFLE_MESSAGE })
  shuffleQuestions?: boolean;
}

export class UpdateTestPublicationDto {
  @ApiProperty({
    enum: TheoryTestPublicationStatus,
    example: TheoryTestPublicationStatus.PUBLISHED,
    description:
      'PUBLISHED перевіряє, що в тесті є питання і кожне відповідає format. ' +
      'DRAFT знімає публікацію без перевірки структури.',
  })
  @IsEnum(TheoryTestPublicationStatus, { message: TEST_PUBLICATION_MESSAGE })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  publicationStatus: TheoryTestPublicationStatus;
}

export class CreateQuestionDto {
  @ApiProperty({
    example: 'Що означає цей знак?',
    maxLength: QUESTION_TEXT_MAX_LENGTH,
  })
  @Transform(trimString)
  @IsPlainText()
  @MaxLength(QUESTION_TEXT_MAX_LENGTH, {
    message: QUESTION_TEXT_LENGTH_MESSAGE,
  })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'text має бути рядком.' })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  text: string;

  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    description:
      'Позиція в тесті, з 1. Якщо не передати — питання стає останнім.',
  })
  @Transform(integerValue)
  @ValidateIf((_, value) => value !== undefined)
  @Min(1, { message: POSITION_MIN_MESSAGE })
  @IsInt({ message: POSITION_INTEGER_MESSAGE })
  position?: number;

  @ApiPropertyOptional({
    type: [AnswerOptionInputDto],
    description:
      'Варіанти разом із питанням. Для опублікованого тесту набір має одразу відповідати формату. ' +
      'Порядок у масиві стає position з 1.',
  })
  @ValidateNested({ each: true })
  @Type(() => AnswerOptionInputDto)
  @IsArray({ message: OPTIONS_ARRAY_MESSAGE })
  @IsOptional()
  options?: AnswerOptionInputDto[];
}

export class UpdateQuestionDto {
  @ApiPropertyOptional({ example: 'Що зобов’язує зробити цей знак?' })
  @Transform(trimString)
  @ValidateIf((_, value) => value !== undefined)
  @IsPlainText()
  @MaxLength(QUESTION_TEXT_MAX_LENGTH, {
    message: QUESTION_TEXT_LENGTH_MESSAGE,
  })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'text має бути рядком.' })
  text?: string;

  @ApiPropertyOptional({ example: 2, minimum: 1 })
  @Transform(integerValue)
  @ValidateIf((_, value) => value !== undefined)
  @Min(1, { message: POSITION_MIN_MESSAGE })
  @IsInt({ message: POSITION_INTEGER_MESSAGE })
  position?: number;
}

export class CreateAnswerOptionDto extends AnswerOptionInputDto {
  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    description:
      'Позиція серед варіантів питання. Якщо не передати — варіант стає останнім.',
  })
  @Transform(integerValue)
  @ValidateIf((_, value) => value !== undefined)
  @Min(1, { message: POSITION_MIN_MESSAGE })
  @IsInt({ message: POSITION_INTEGER_MESSAGE })
  position?: number;
}

export class UpdateAnswerOptionDto {
  @ApiPropertyOptional({ example: 'Дати дорогу транспорту на головній' })
  @Transform(trimString)
  @ValidateIf((_, value) => value !== undefined)
  @IsPlainText()
  @MaxLength(OPTION_TEXT_MAX_LENGTH, { message: OPTION_TEXT_LENGTH_MESSAGE })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'text має бути рядком.' })
  text?: string;

  @ApiPropertyOptional({
    example: true,
    description:
      'Для SINGLE_CHOICE і TRUE_FALSE значення true знімає позначку з інших варіантів цього питання.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean({ message: CORRECT_FLAG_MESSAGE })
  isCorrect?: boolean;

  @ApiPropertyOptional({ example: 2, minimum: 1 })
  @Transform(integerValue)
  @ValidateIf((_, value) => value !== undefined)
  @Min(1, { message: POSITION_MIN_MESSAGE })
  @IsInt({ message: POSITION_INTEGER_MESSAGE })
  position?: number;
}
