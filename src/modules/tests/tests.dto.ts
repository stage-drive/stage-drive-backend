import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { TheoryTestFormat, TheoryTestPublicationStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsIn,
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
export const QUESTION_TYPE_MESSAGE =
  'type має бути SINGLE_CHOICE, MULTIPLE_CHOICE або TRUE_FALSE.';
export const TEST_PUBLICATION_MESSAGE =
  'publicationStatus має бути DRAFT або PUBLISHED. Для архіву є PATCH /tests/{testId}/archive.';
export const TEST_STATUS_FILTER_MESSAGE =
  'publicationStatus має бути DRAFT, PUBLISHED або ARCHIVED.';
export const PASSING_SCORE_MESSAGE = `passingScore має бути цілим числом від ${PASSING_SCORE_MIN} до ${PASSING_SCORE_MAX}.`;
export const TIME_LIMIT_MESSAGE = `timeLimitMinutes має бути цілим числом від ${TIME_LIMIT_MIN} до ${TIME_LIMIT_MAX} або null.`;
export const MAX_ATTEMPTS_MESSAGE = `maxAttempts має бути цілим числом від ${MAX_ATTEMPTS_MIN} до ${MAX_ATTEMPTS_MAX} або null.`;
export const SHUFFLE_MESSAGE = 'shuffleQuestions має бути true або false.';
export const COURSE_ID_MESSAGE = 'courseId має бути UUID.';
export const LESSON_ID_MESSAGE = 'lessonId має бути UUID.';

function emptyToUndefined({ value }: { value: unknown }): unknown {
  return value === '' ? undefined : value;
}

export class TestListQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Лише тести цього курсу. Для TEACHER курс має бути призначений його групі.',
  })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsUUID('4', { message: COURSE_ID_MESSAGE })
  courseId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Лише тести цього уроку програми курсу (CourseLesson). Для TEACHER курс уроку має бути призначений його групі.',
  })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsUUID('4', { message: LESSON_ID_MESSAGE })
  lessonId?: string;

  @ApiPropertyOptional({
    enum: TheoryTestPublicationStatus,
    description:
      'Лише тести з цим статусом. Без фільтра повертаються всі, включно з ARCHIVED.',
  })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsEnum(TheoryTestPublicationStatus, { message: TEST_STATUS_FILTER_MESSAGE })
  publicationStatus?: TheoryTestPublicationStatus;
}

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

  @ApiProperty({
    enum: TheoryTestFormat,
    example: TheoryTestFormat.SINGLE_CHOICE,
    description:
      'Тип питання. SINGLE_CHOICE — одна правильна відповідь. MULTIPLE_CHOICE — кілька. TRUE_FALSE — так/ні. ' +
      'У одному тесті можуть бути питання різних типів.',
  })
  type: TheoryTestFormat;

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
      'Урок програми курсу (CourseLesson), до якого прив’язаний тест. ' +
      'null — старий тест усього курсу без уроку: його не можна опублікувати, доки не вказано lessonId. ' +
      'У тесту уроку рівно 3 спроби.',
  })
  lessonId: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    deprecated: true,
    description: 'Те саме, що lessonId. Лишено для сумісності.',
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
      'Тип за замовчуванням для нових питань. Тип кожного питання лежить у questions[].type, ' +
      'тож в одному тесті можуть бути питання різних типів.',
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
      'Новий тест завжди DRAFT. PUBLISHED ставиться лише PATCH /tests/{testId}/publication після перевірки (UC-003). ' +
      'ARCHIVED ставиться PATCH /tests/{testId}/archive: студенти такий тест не бачать, історія спроб лишається.',
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

  @ApiProperty({
    enum: TheoryTestFormat,
    example: TheoryTestFormat.SINGLE_CHOICE,
    description: 'Тип питання: скільки варіантів можна обрати.',
  })
  type: TheoryTestFormat;

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
      'Лише тести зі збереженим publicationStatus PUBLISHED. Чернетки й архівні не повертаються.',
  })
  tests: TestListItemDto[];
}

export class LessonTestOptionDto {
  @ApiProperty({ example: '81818181-8181-4818-8818-818181818181' })
  id: string;

  @ApiProperty({ example: 'Поступитися дорогою' })
  text: string;

  @ApiProperty({ example: 1, minimum: 1 })
  position: number;
}

export class LessonTestQuestionDto {
  @ApiProperty({ example: '71717171-7171-4717-8717-717171717171' })
  id: string;

  @ApiProperty({
    enum: TheoryTestFormat,
    example: TheoryTestFormat.SINGLE_CHOICE,
    description: 'Тип питання: скільки варіантів можна обрати.',
  })
  type: TheoryTestFormat;

  @ApiProperty({ example: 'Що означає цей знак?' })
  text: string;

  @ApiProperty({ example: 1, minimum: 1 })
  position: number;

  @ApiProperty({
    type: [LessonTestOptionDto],
    description:
      'Варіанти без isCorrect: правильну відповідь студент не отримує.',
  })
  options: LessonTestOptionDto[];
}

/**
 * Опублікований тест уроку для студента: зміст без isCorrect і стан його спроб.
 * Лічильники рахують поточний цикл спроб.
 */
export class LessonTestDto {
  @ApiProperty({ example: '61616161-6161-4616-8616-616161616161' })
  id: string;

  @ApiProperty({
    example: '51515151-5151-4515-8515-515151515151',
    description: 'Урок програми курсу (CourseLesson), тест якого повернуто.',
  })
  lessonId: string;

  @ApiProperty({ example: '41414141-4141-4414-8414-414141414141' })
  courseId: string;

  @ApiProperty({ example: 'Тест: дорожні знаки' })
  name: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({
    enum: TheoryTestPublicationStatus,
    example: TheoryTestPublicationStatus.PUBLISHED,
    description:
      'Студент бачить лише опублікований тест, тож тут завжди PUBLISHED.',
  })
  status: TheoryTestPublicationStatus;

  @ApiProperty({ example: 80, description: 'Поріг складання у відсотках.' })
  passingScore: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 20,
    description:
      'Ліміт часу на одну спробу в хвилинах. null — без обмеження. Час рахує сервер від startedAt.',
  })
  timeLimitMinutes: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 3,
    description: 'Скільки спроб дає один цикл. У тесту уроку їх 3.',
  })
  maxAttempts: number | null;

  @ApiProperty({ example: false })
  shuffleQuestions: boolean;

  @ApiProperty({ example: 10 })
  questionCount: number;

  @ApiProperty({
    type: [LessonTestQuestionDto],
    description: 'Питання за position. Позначок правильних відповідей немає.',
  })
  questions: LessonTestQuestionDto[];

  @ApiProperty({
    example: false,
    description:
      'Тест уже складено. Лише PASSED відкриває наступний урок; перегляд матеріалів не обов’язковий.',
  })
  passed: boolean;

  @ApiProperty({
    example: 1,
    description:
      'Скільки спроб поточного циклу вже зайнято: витрачені та відкрита (IN_PROGRESS).',
  })
  attemptsUsed: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 2,
    description:
      'Скільки спроб ще можна почати в поточному циклі. 0 — спроби вичерпано, пройдіть урок ще раз.',
  })
  attemptsLeft: number | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Відкрита спроба, яку можна продовжити через GET /tests/attempts/{attemptId}.',
  })
  openAttemptId: string | null;

  @ApiProperty({
    example: true,
    description:
      'Чи можна зараз почати нову спробу (POST /tests/{testId}/attempts).',
  })
  nextAttemptAvailable: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['IN_PROGRESS', 'ALREADY_PASSED', 'ATTEMPTS_EXHAUSTED'],
    description:
      'Чому нову спробу почати не можна. null — можна. ' +
      'IN_PROGRESS — є відкрита спроба. ALREADY_PASSED — тест складено. ATTEMPTS_EXHAUSTED — ліміт циклу вичерпано.',
  })
  unavailableReason: string | null;

  @ApiProperty({
    example: true,
    description:
      'Наступний урок закритий, доки тест не складено (passed = false).',
  })
  lockedNextUntilPassed: boolean;

  @ApiPropertyOptional({
    example: 'Пройдіть урок ще раз.',
    description:
      'Є лише коли спроби вичерпано без складеного тесту. Нові 3 спроби з’являються після того, ' +
      'як студент знову позначить урок пройденим (POST /courses/{courseId}/lessons/{lessonId}/complete).',
  })
  message?: string;
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
  @ApiPropertyOptional({
    example: '51515151-5151-4515-8515-515151515151',
    description:
      'Урок програми курсу (CourseLesson), до якого належить тест. Курс береться з уроку. ' +
      'Урок іншої автошколи дає 404, а в уроку може бути лише один не архівний тест (409). ' +
      'Тест уроку завжди має 3 спроби. Потрібен lessonId або (застарілий) courseId.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID('4', { message: LESSON_ID_MESSAGE })
  lessonId?: string;

  @ApiPropertyOptional({
    example: '41414141-4141-4414-8414-414141414141',
    deprecated: true,
    description:
      'Застаріло: тест належить уроку, а не курсу. Без lessonId створюється тест курсу без уроку, ' +
      'який не можна опублікувати, доки не вказано lessonId (PATCH /tests/{testId}). ' +
      'Якщо передано разом із lessonId, курс має збігатися з курсом уроку. Курс іншої організації дає 404.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID('4', { message: COURSE_ID_MESSAGE })
  courseId?: string;

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

  @ApiPropertyOptional({
    enum: TheoryTestFormat,
    default: TheoryTestFormat.SINGLE_CHOICE,
    example: TheoryTestFormat.SINGLE_CHOICE,
    description:
      'Тип за замовчуванням для нових питань. Тип кожного питання задається в питанні (type), ' +
      'тож тест може мати питання різних типів.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(TheoryTestFormat, { message: TEST_FORMAT_MESSAGE })
  format?: TheoryTestFormat;

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

/** Тест уроку. Курс і урок беруться з адреси, maxAttempts завжди 3. */
export class CreateLessonTestDto extends OmitType(CreateTestDto, [
  'courseId',
  'lessonId',
  'maxAttempts',
] as const) {}

export class UpdateTestDto {
  @ApiPropertyOptional({
    example: '51515151-5151-4515-8515-515151515151',
    description:
      'Прив’язує чернетку до уроку курсу тесту (або переносить на інший урок). ' +
      'Лише для DRAFT: урок опублікованого тесту не змінюється (409). У уроку не може бути двох не архівних тестів (409).',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID('4', { message: LESSON_ID_MESSAGE })
  lessonId?: string;

  @ApiPropertyOptional({
    example: '41414141-4141-4414-8414-414141414141',
    deprecated: true,
    description:
      'Застаріло. Курс тесту уроку не змінюється (409): тест лишається на курсі свого уроку.',
  })
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

  @ApiPropertyOptional({
    enum: TheoryTestFormat,
    description:
      'Тип за замовчуванням для нових питань. Існуючі питання не змінюються: їхній тип лежить у питанні (type).',
  })
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

/** Статуси, які можна поставити публікацією. ARCHIVED ставить лише PATCH /tests/{testId}/archive. */
export const PUBLICATION_TARGET_STATUSES = [
  TheoryTestPublicationStatus.DRAFT,
  TheoryTestPublicationStatus.PUBLISHED,
] as const;

export class UpdateTestPublicationDto {
  @ApiProperty({
    enum: PUBLICATION_TARGET_STATUSES,
    example: TheoryTestPublicationStatus.PUBLISHED,
    description:
      'PUBLISHED перевіряє тест (UC-003): назва, урок, поріг складання, ліміт спроб більший за 0, ' +
      'щонайменше одне питання, а в кожного питання — варіанти і правильні відповіді за його типом. ' +
      'Помилки повертаються списком errors[{field, message}]. ' +
      'DRAFT знімає публікацію без перевірки структури. Архівний тест не публікується (409).',
  })
  @IsIn(PUBLICATION_TARGET_STATUSES, { message: TEST_PUBLICATION_MESSAGE })
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
    enum: TheoryTestFormat,
    example: TheoryTestFormat.SINGLE_CHOICE,
    description:
      'Тип питання: SINGLE_CHOICE, MULTIPLE_CHOICE або TRUE_FALSE. ' +
      'Якщо не передати — береться format тесту.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(TheoryTestFormat, { message: QUESTION_TYPE_MESSAGE })
  type?: TheoryTestFormat;

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

  @ApiPropertyOptional({
    enum: TheoryTestFormat,
    description:
      'Новий тип питання. Наявні варіанти мають відповідати йому: для опублікованого тесту — повністю, ' +
      'для чернетки — не більше однієї правильної відповіді в SINGLE_CHOICE і TRUE_FALSE.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(TheoryTestFormat, { message: QUESTION_TYPE_MESSAGE })
  type?: TheoryTestFormat;

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
