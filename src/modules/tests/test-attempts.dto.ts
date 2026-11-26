import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  TheoryTestAttemptStatus,
  TheoryTestFormat,
  TheoryTestStatus,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { REQUIRED_FIELD_MESSAGE } from '../courses/courses.dto';
import {
  AttemptApiResult,
  AttemptApiStatus,
  NextAttemptBlockReason,
} from './test-attempts.rules';

export const ANSWERS_ARRAY_MESSAGE = 'answers має бути масивом відповідей.';
export const QUESTION_ID_MESSAGE = 'questionId має бути UUID.';
export const OPTION_IDS_MESSAGE = 'optionIds має бути масивом UUID.';
export const ATTEMPT_STATUS_FILTER_MESSAGE =
  'status має бути IN_PROGRESS, COMPLETED або EXPIRED.';
export const ATTEMPT_RESULT_FILTER_MESSAGE =
  'result має бути PASSED або FAILED.';
export const ATTEMPT_TEST_ID_MESSAGE = 'testId має бути UUID.';
export const ATTEMPT_LESSON_ID_MESSAGE = 'lessonId має бути UUID.';
export const ATTEMPT_GROUP_ID_MESSAGE = 'groupId має бути UUID.';
export const ATTEMPT_STUDENT_ID_MESSAGE = 'studentId має бути UUID.';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_PAGE = 10_000;
const MAX_LIMIT = 100;

const ATTEMPT_STATUSES = Object.values(AttemptApiStatus);
const ATTEMPT_RESULTS = Object.values(AttemptApiResult);

function emptyToUndefined({ value }: { value: unknown }): unknown {
  return value === '' ? undefined : value;
}

function optionalInteger({ value }: { value: unknown }): unknown {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return typeof value === 'number' ? value : Number(value);
}

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
      'Є лише в перевіреній спробі (status = COMPLETED). У IN_PROGRESS і EXPIRED поле не повертається.',
  })
  isCorrect?: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      'Чи студент обрав цей варіант. Є лише в перевіреній спробі (status = COMPLETED).',
  })
  selected?: boolean;
}

export class AttemptQuestionDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Id питання тесту на момент старту. Саме його треба надсилати в answers.',
  })
  id: string;

  @ApiProperty({
    enum: TheoryTestFormat,
    example: TheoryTestFormat.SINGLE_CHOICE,
    description:
      'Тип питання, знятий на старті: SINGLE_CHOICE і TRUE_FALSE — один варіант, MULTIPLE_CHOICE — кілька.',
  })
  type: TheoryTestFormat;

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

export class AttemptAnswerDto {
  @ApiProperty({ format: 'uuid', description: 'Id питання зі спроби.' })
  questionId: string;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Варіанти, які студент уже обрав у цьому питанні.',
  })
  optionIds: string[];
}

export class TestAttemptDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  testId: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Урок програми курсу (CourseLesson), до якого прив’язано тест. null — старий тест курсу без уроку.',
  })
  lessonId: string | null;

  @ApiProperty({ format: 'uuid' })
  courseId: string;

  @ApiProperty({ format: 'uuid' })
  studentId: string;

  @ApiProperty({
    enum: AttemptApiStatus,
    enumName: 'TestAttemptStatus',
    example: AttemptApiStatus.IN_PROGRESS,
    description:
      'IN_PROGRESS — триває. COMPLETED — перевірена сервером, результат у полі result. ' +
      'EXPIRED — час вийшов до здачі, спробу витрачено без оцінки.',
  })
  status: AttemptApiStatus;

  @ApiProperty({
    enum: AttemptApiResult,
    enumName: 'TestAttemptResult',
    nullable: true,
    example: null,
    description:
      'PASSED або FAILED рахує лише сервер за passingScore. null, доки спроба IN_PROGRESS або EXPIRED.',
  })
  result: AttemptApiResult | null;

  @ApiProperty({
    example: 1,
    description:
      'Цикл спроб уроку. Нові 3 спроби починають наступний цикл, історія попередніх лишається.',
  })
  cycle: number;

  @ApiProperty({
    example: 1,
    minimum: 1,
    description: 'Номер цієї спроби в її циклі, з 1.',
  })
  attemptNumber: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 3,
    description:
      'Скільки спроб дає цикл. У тесту уроку їх 3. null — без ліміту.',
  })
  maxAttempts: number | null;

  @ApiProperty({
    example: 1,
    description:
      'Скільки спроб циклу цієї спроби вже зайнято: витрачені та відкрита. Рахується на момент відповіді.',
  })
  attemptsUsed: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 2,
    description:
      'Скільки спроб ще можна почати в цьому циклі. 0 — спроби вичерпано. null — без ліміту.',
  })
  attemptsLeft: number | null;

  @ApiProperty({ type: String, format: 'date-time' })
  startedAt: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Дедлайн сервера: startedAt + timeLimitMinutes. null — тест без ліміту. Клієнтський таймер цей момент не подовжує.',
  })
  expiresAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  submittedAt: Date | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 20,
    description: 'Ліміт у хвилинах, знятий на старті. null — без обмеження.',
  })
  timeLimitMinutes: number | null;

  @ApiProperty({ example: 80, minimum: 1, maximum: 100 })
  passingScore: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 90,
    description:
      'Відсоток правильних відповідей, ціле число. null, доки спроба не перевірена (IN_PROGRESS або EXPIRED).',
  })
  scorePercent: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 9,
    description: 'Зароблені бали: кожне питання варте одного бала.',
  })
  earnedPoints: number | null;

  @ApiProperty({
    example: 10,
    description: 'Максимум балів: стільки, скільки питань у спробі.',
  })
  maxPoints: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 9,
    description:
      'Скільки питань відповідено точно. null, доки спроба не перевірена.',
  })
  correctCount: number | null;

  @ApiProperty({ example: 10, description: 'Скільки питань у цій спробі.' })
  totalQuestions: number;

  @ApiProperty({ type: [AttemptQuestionDto] })
  questions: AttemptQuestionDto[];

  @ApiProperty({
    type: [AttemptAnswerDto],
    description:
      'Збережені відповіді студента: щоб продовжити спробу після перезавантаження. Питання без відповіді не входять.',
  })
  answers: AttemptAnswerDto[];

  @ApiPropertyOptional({
    example: 'Пройдіть урок ще раз.',
    description:
      'Є, коли всі спроби циклу витрачено без складеного тесту. Нові 3 спроби з’являються після повторного проходження уроку.',
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
      'IN_PROGRESS — треба продовжити відкриту спробу. ALREADY_PASSED — тест складено. ' +
      'ATTEMPTS_EXHAUSTED — спроби циклу вичерпано: «Пройдіть урок ще раз.».',
  })
  reason: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Id уже відкритої спроби. Є лише коли reason = IN_PROGRESS.',
  })
  attemptId?: string;
}

export class AttemptClosedDto {
  @ApiProperty({ example: 409 })
  statusCode: number;

  @ApiProperty({ example: 'Час спроби вийшов. Відповіді не збережено.' })
  message: string;

  @ApiProperty({
    enum: AttemptApiStatus,
    enumName: 'TestAttemptStatus',
    example: AttemptApiStatus.EXPIRED,
    description: 'Стан спроби, яка вже не приймає відповіді.',
  })
  status: AttemptApiStatus;
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
      'Скільки спроб поточного циклу вже витрачено: PASSED, FAILED і EXPIRED. Відкрита спроба сюди не входить.',
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

export class AttemptSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  testId: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Урок програми курсу (CourseLesson). null — тест курсу без уроку.',
  })
  lessonId: string | null;

  @ApiProperty({ format: 'uuid' })
  courseId: string;

  @ApiProperty({
    enum: AttemptApiStatus,
    enumName: 'TestAttemptStatus',
    example: AttemptApiStatus.COMPLETED,
  })
  status: AttemptApiStatus;

  @ApiProperty({
    enum: AttemptApiResult,
    enumName: 'TestAttemptResult',
    nullable: true,
    example: AttemptApiResult.PASSED,
    description: 'null, доки спроба IN_PROGRESS або EXPIRED.',
  })
  result: AttemptApiResult | null;

  @ApiProperty({ example: 1 })
  cycle: number;

  @ApiProperty({ example: 1, description: 'Номер спроби в її циклі, з 1.' })
  attemptNumber: number;

  @ApiProperty({ type: Number, nullable: true, example: 90 })
  scorePercent: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 9 })
  correctCount: number | null;

  @ApiProperty({ example: 10 })
  totalQuestions: number;

  @ApiProperty({ example: 80 })
  passingScore: number;

  @ApiProperty({ type: String, format: 'date-time' })
  startedAt: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiresAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  submittedAt: Date | null;
}

export class OwnTestAttemptsDto {
  @ApiProperty({ format: 'uuid' })
  testId: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  lessonId: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 3,
    description: 'Скільки спроб дає цикл. null — без ліміту.',
  })
  maxAttempts: number | null;

  @ApiProperty({ example: 1, description: 'Поточний цикл спроб, з 1.' })
  cycle: number;

  @ApiProperty({
    example: false,
    description: 'Тест складено хоча б раз. Лише це відкриває наступний урок.',
  })
  passed: boolean;

  @ApiProperty({
    example: 1,
    description: 'Зайнято спроб поточного циклу: витрачені та відкрита.',
  })
  attemptsUsed: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 2,
    description:
      'Скільки спроб ще можна почати в поточному циклі. null — без ліміту.',
  })
  attemptsLeft: number | null;

  @ApiProperty({ example: true })
  nextAttemptAvailable: boolean;

  @ApiProperty({
    enum: NextAttemptBlockReason,
    nullable: true,
    example: null,
    description:
      'Чому нову спробу почати не можна. null — можна. TEST_UNAVAILABLE — тест, курс або урок зараз закриті.',
  })
  unavailableReason: NextAttemptBlockReason | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Відкрита спроба, яку можна продовжити.',
  })
  openAttemptId: string | null;

  @ApiPropertyOptional({
    example: 'Пройдіть урок ще раз.',
    description:
      'Є, коли спроби поточного циклу вичерпано без складеного тесту.',
  })
  message?: string;

  @ApiProperty({
    type: [AttemptSummaryDto],
    description:
      'Усі спроби цього студента й тесту за всі цикли, від новішої. Питання і правильні відповіді не входять.',
  })
  attempts: AttemptSummaryDto[];
}

export class MyAttemptSummaryDto extends AttemptSummaryDto {
  @ApiProperty({ example: 'Тест: дорожні знаки' })
  testName: string;
}

export class TestAttemptPaginationDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 1 })
  total: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}

export class MyTestAttemptListDto {
  @ApiProperty({ type: [MyAttemptSummaryDto] })
  attempts: MyAttemptSummaryDto[];

  @ApiProperty({ type: TestAttemptPaginationDto })
  pagination: TestAttemptPaginationDto;
}

export class StaffTestAttemptDto extends MyAttemptSummaryDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    example: 3,
    description: 'Скільки спроб дає цикл. null — без ліміту.',
  })
  maxAttempts: number | null;

  @ApiProperty({ format: 'uuid' })
  studentId: string;

  @ApiProperty({ example: 'Олена' })
  firstName: string;

  @ApiProperty({ example: 'Коваль' })
  lastName: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Група студента на курсі цього тесту. null, якщо зарахування вже немає. Для TEACHER — його група.',
  })
  groupId: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Група B-12' })
  groupName: string | null;
}

export class StaffTestAttemptListDto {
  @ApiProperty({ type: [StaffTestAttemptDto] })
  attempts: StaffTestAttemptDto[];

  @ApiProperty({ type: TestAttemptPaginationDto })
  pagination: TestAttemptPaginationDto;
}

class AttemptPaginationQueryDto {
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

class AttemptStateQueryDto extends AttemptPaginationQueryDto {
  @ApiPropertyOptional({
    enum: AttemptApiStatus,
    enumName: 'TestAttemptStatus',
    description:
      'Лише спроби з цим статусом. COMPLETED — перевірені (PASSED і FAILED).',
  })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsIn(ATTEMPT_STATUSES, { message: ATTEMPT_STATUS_FILTER_MESSAGE })
  status?: AttemptApiStatus;

  @ApiPropertyOptional({
    enum: AttemptApiResult,
    enumName: 'TestAttemptResult',
    description: 'Лише перевірені спроби з цим результатом.',
  })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsIn(ATTEMPT_RESULTS, { message: ATTEMPT_RESULT_FILTER_MESSAGE })
  result?: AttemptApiResult;
}

export class MyTestAttemptsQueryDto extends AttemptStateQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Лише спроби цього тесту.',
  })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsUUID('4', { message: ATTEMPT_TEST_ID_MESSAGE })
  testId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Лише спроби тесту цього уроку програми курсу (CourseLesson).',
  })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsUUID('4', { message: ATTEMPT_LESSON_ID_MESSAGE })
  lessonId?: string;
}

export class StaffTestAttemptsQueryDto extends AttemptStateQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Лише студенти цієї групи. TEACHER може вказати лише свою групу, інакше 403.',
  })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsUUID('4', { message: ATTEMPT_GROUP_ID_MESSAGE })
  groupId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Лише спроби цього студента.',
  })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsUUID('4', { message: ATTEMPT_STUDENT_ID_MESSAGE })
  studentId?: string;
}

export class StaffAllTestAttemptsQueryDto extends StaffTestAttemptsQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Лише спроби цього тесту.',
  })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsUUID('4', { message: ATTEMPT_TEST_ID_MESSAGE })
  testId?: string;
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

export class SaveAttemptAnswersDto {
  @ApiProperty({
    type: [SubmitAttemptAnswerDto],
    description:
      'Відповіді, які треба зберегти. Для кожного переліченого питання збережений вибір замінюється, ' +
      'порожній optionIds його очищає. Питання, яких тут немає, лишаються як були.',
  })
  @ValidateNested({ each: true })
  @Type(() => SubmitAttemptAnswerDto)
  @IsArray({ message: ANSWERS_ARRAY_MESSAGE })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  answers: SubmitAttemptAnswerDto[];
}

export class SubmitAttemptDto {
  @ApiPropertyOptional({
    type: [SubmitAttemptAnswerDto],
    description:
      'Остаточні відповіді. Якщо передано, вони замінюють усі збережені (відсутнє питання — без відповіді). ' +
      'Якщо поля немає, сервер перевіряє відповіді, збережені через PATCH /tests/attempts/{attemptId}/answers. ' +
      'Бали і результат клієнт не передає: їх рахує сервер.',
  })
  @ValidateNested({ each: true })
  @Type(() => SubmitAttemptAnswerDto)
  @IsArray({ message: ANSWERS_ARRAY_MESSAGE })
  @IsOptional()
  answers?: SubmitAttemptAnswerDto[];
}
