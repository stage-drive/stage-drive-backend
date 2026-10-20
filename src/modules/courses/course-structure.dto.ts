import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CourseMaterialType, CourseStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsPlainText } from '../../common/validators/plain-text.decorator';
import {
  COURSE_DESCRIPTION_LENGTH_MESSAGE,
  COURSE_DESCRIPTION_MAX_LENGTH,
  REQUIRED_FIELD_MESSAGE,
} from './courses.dto';

export const STRUCTURE_TITLE_MAX_LENGTH = 200;
export const MATERIAL_BODY_MAX_LENGTH = 20_000;
export const MATERIAL_URL_MAX_LENGTH = 2048;
export const STRUCTURE_TITLE_LENGTH_MESSAGE = `Назва має містити не більше ${STRUCTURE_TITLE_MAX_LENGTH} символів.`;
export const MATERIAL_BODY_LENGTH_MESSAGE = `Текст має містити не більше ${MATERIAL_BODY_MAX_LENGTH} символів.`;
export const POSITION_INTEGER_MESSAGE = 'position має бути цілим числом.';
export const POSITION_MIN_MESSAGE = 'position має бути не менше 1.';
export const MATERIAL_TYPE_MESSAGE = 'type має бути TEXT, LINK або VIDEO.';

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** Порожній рядок — це відсутність значення, а не рядок із пробілів. */
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

export class MaterialDto {
  @ApiProperty({ example: '71717171-7171-4717-8717-717171717171' })
  id: string;

  @ApiProperty({ example: '41414141-4141-4414-8414-414141414141' })
  courseId: string;

  @ApiProperty({ example: '61616161-6161-4616-8616-616161616161' })
  lessonId: string;

  @ApiProperty({ example: 'Групи дорожніх знаків' })
  title: string;

  @ApiProperty({
    enum: CourseMaterialType,
    example: CourseMaterialType.TEXT,
  })
  type: CourseMaterialType;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Для TEXT — текст матеріалу. Для LINK і VIDEO — адреса http або https. null, якщо тексту ще немає.',
    example: 'Попереджувальні, пріоритету, заборонні, наказові, інформаційні.',
  })
  body: string | null;

  @ApiProperty({ example: 1, minimum: 1 })
  position: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class LessonDto {
  @ApiProperty({ example: '61616161-6161-4616-8616-616161616161' })
  id: string;

  @ApiProperty({ example: '41414141-4141-4414-8414-414141414141' })
  courseId: string;

  @ApiProperty({ example: '51515151-5151-4515-8515-515151515151' })
  chapterId: string;

  @ApiProperty({ example: 'Дорожні знаки' })
  title: string;

  @ApiProperty({ type: String, nullable: true, example: 'Огляд груп знаків.' })
  description: string | null;

  @ApiProperty({ example: 1, minimum: 1 })
  position: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class ChapterDto {
  @ApiProperty({ example: '51515151-5151-4515-8515-515151515151' })
  id: string;

  @ApiProperty({ example: '41414141-4141-4414-8414-414141414141' })
  courseId: string;

  @ApiProperty({ example: 'Правила дорожнього руху' })
  title: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Знаки, розмітка та регулювання.',
  })
  description: string | null;

  @ApiProperty({ example: 1, minimum: 1 })
  position: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class LessonStructureDto {
  @ApiProperty({ example: '61616161-6161-4616-8616-616161616161' })
  id: string;

  @ApiProperty({ example: '41414141-4141-4414-8414-414141414141' })
  courseId: string;

  @ApiProperty({ example: '51515151-5151-4515-8515-515151515151' })
  chapterId: string;

  @ApiProperty({ example: 'Дорожні знаки' })
  title: string;

  @ApiProperty({ type: String, nullable: true, example: 'Огляд груп знаків.' })
  description: string | null;

  @ApiProperty({ example: 1, minimum: 1 })
  position: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ type: [MaterialDto] })
  materials: MaterialDto[];
}

export class ChapterStructureDto {
  @ApiProperty({ example: '51515151-5151-4515-8515-515151515151' })
  id: string;

  @ApiProperty({ example: '41414141-4141-4414-8414-414141414141' })
  courseId: string;

  @ApiProperty({ example: 'Правила дорожнього руху' })
  title: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Знаки, розмітка та регулювання.',
  })
  description: string | null;

  @ApiProperty({ example: 1, minimum: 1 })
  position: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ type: [LessonStructureDto] })
  lessons: LessonStructureDto[];
}

/** Курс своєї автошколи разом із розділами, уроками та матеріалами за position. */
export class CourseStructureDto {
  @ApiProperty({ example: '41414141-4141-4414-8414-414141414141' })
  id: string;

  @ApiProperty({ example: 'Теоретичний курс, категорія B' })
  name: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'ПДР, основи безпеки руху та будова автомобіля.',
  })
  description: string | null;

  @ApiProperty({ enum: CourseStatus, example: CourseStatus.ACTIVE })
  status: CourseStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ type: [ChapterStructureDto] })
  chapters: ChapterStructureDto[];
}

export class CreateChapterDto {
  @ApiProperty({
    example: 'Правила дорожнього руху',
    maxLength: STRUCTURE_TITLE_MAX_LENGTH,
    description: 'Пробіли по краях обрізаються.',
  })
  @Transform(trimString)
  @IsPlainText()
  @MaxLength(STRUCTURE_TITLE_MAX_LENGTH, {
    message: STRUCTURE_TITLE_LENGTH_MESSAGE,
  })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'title має бути рядком.' })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  title: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: COURSE_DESCRIPTION_MAX_LENGTH,
    example: 'Знаки, розмітка та регулювання.',
    description:
      'Пробіли по краях обрізаються. Порожній рядок зберігається як null.',
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
    example: 1,
    minimum: 1,
    description:
      'Позиція в курсі, з 1. Якщо не передати — розділ стає останнім. Сусіди зсуваються.',
  })
  @Transform(integerValue)
  @ValidateIf((_, value) => value !== undefined)
  @Min(1, { message: POSITION_MIN_MESSAGE })
  @IsInt({ message: POSITION_INTEGER_MESSAGE })
  position?: number;
}

export class UpdateChapterDto {
  @ApiPropertyOptional({
    example: 'Правила дорожнього руху (оновлено)',
    maxLength: STRUCTURE_TITLE_MAX_LENGTH,
  })
  @Transform(trimString)
  @ValidateIf((_, value) => value !== undefined)
  @IsPlainText()
  @MaxLength(STRUCTURE_TITLE_MAX_LENGTH, {
    message: STRUCTURE_TITLE_LENGTH_MESSAGE,
  })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'title має бути рядком.' })
  title?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: COURSE_DESCRIPTION_MAX_LENGTH,
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
    example: 2,
    minimum: 1,
    description: 'Нова позиція серед розділів цього курсу. Сусіди зсуваються.',
  })
  @Transform(integerValue)
  @ValidateIf((_, value) => value !== undefined)
  @Min(1, { message: POSITION_MIN_MESSAGE })
  @IsInt({ message: POSITION_INTEGER_MESSAGE })
  position?: number;
}

export class CreateLessonDto {
  @ApiProperty({
    example: 'Дорожні знаки',
    maxLength: STRUCTURE_TITLE_MAX_LENGTH,
    description: 'Пробіли по краях обрізаються.',
  })
  @Transform(trimString)
  @IsPlainText()
  @MaxLength(STRUCTURE_TITLE_MAX_LENGTH, {
    message: STRUCTURE_TITLE_LENGTH_MESSAGE,
  })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'title має бути рядком.' })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  title: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: COURSE_DESCRIPTION_MAX_LENGTH,
    example: 'Огляд груп знаків.',
    description:
      'Пробіли по краях обрізаються. Порожній рядок зберігається як null.',
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
    example: 1,
    minimum: 1,
    description:
      'Позиція в розділі, з 1. Якщо не передати — урок стає останнім.',
  })
  @Transform(integerValue)
  @ValidateIf((_, value) => value !== undefined)
  @Min(1, { message: POSITION_MIN_MESSAGE })
  @IsInt({ message: POSITION_INTEGER_MESSAGE })
  position?: number;
}

export class UpdateLessonDto {
  @ApiPropertyOptional({
    example: 'Дорожні знаки і розмітка',
    maxLength: STRUCTURE_TITLE_MAX_LENGTH,
  })
  @Transform(trimString)
  @ValidateIf((_, value) => value !== undefined)
  @IsPlainText()
  @MaxLength(STRUCTURE_TITLE_MAX_LENGTH, {
    message: STRUCTURE_TITLE_LENGTH_MESSAGE,
  })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'title має бути рядком.' })
  title?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: COURSE_DESCRIPTION_MAX_LENGTH,
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
    example: 2,
    minimum: 1,
    description: 'Нова позиція серед уроків цього розділу.',
  })
  @Transform(integerValue)
  @ValidateIf((_, value) => value !== undefined)
  @Min(1, { message: POSITION_MIN_MESSAGE })
  @IsInt({ message: POSITION_INTEGER_MESSAGE })
  position?: number;
}

export class CreateMaterialDto {
  @ApiProperty({
    example: 'Групи дорожніх знаків',
    maxLength: STRUCTURE_TITLE_MAX_LENGTH,
  })
  @Transform(trimString)
  @IsPlainText()
  @MaxLength(STRUCTURE_TITLE_MAX_LENGTH, {
    message: STRUCTURE_TITLE_LENGTH_MESSAGE,
  })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'title має бути рядком.' })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  title: string;

  @ApiPropertyOptional({
    enum: CourseMaterialType,
    default: CourseMaterialType.TEXT,
    description:
      'TEXT — текст у body. LINK і VIDEO — http(s) адреса в body. За замовчуванням TEXT.',
  })
  @IsOptional()
  @IsEnum(CourseMaterialType, { message: MATERIAL_TYPE_MESSAGE })
  type?: CourseMaterialType;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: MATERIAL_BODY_MAX_LENGTH,
    example: 'Попереджувальні, пріоритету, заборонні, наказові, інформаційні.',
    description:
      'Для LINK і VIDEO поле обов’язкове і має бути адресою http або https. Порожній рядок зберігається як null.',
  })
  @Transform(emptyToNull)
  @IsOptional()
  @IsPlainText()
  @MaxLength(MATERIAL_BODY_MAX_LENGTH, {
    message: MATERIAL_BODY_LENGTH_MESSAGE,
  })
  @IsString({ message: 'body має бути рядком або null.' })
  body?: string | null;

  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    description:
      'Позиція в уроці, з 1. Якщо не передати — матеріал стає останнім.',
  })
  @Transform(integerValue)
  @ValidateIf((_, value) => value !== undefined)
  @Min(1, { message: POSITION_MIN_MESSAGE })
  @IsInt({ message: POSITION_INTEGER_MESSAGE })
  position?: number;
}

export class UpdateMaterialDto {
  @ApiPropertyOptional({
    example: 'Групи знаків',
    maxLength: STRUCTURE_TITLE_MAX_LENGTH,
  })
  @Transform(trimString)
  @ValidateIf((_, value) => value !== undefined)
  @IsPlainText()
  @MaxLength(STRUCTURE_TITLE_MAX_LENGTH, {
    message: STRUCTURE_TITLE_LENGTH_MESSAGE,
  })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'title має бути рядком.' })
  title?: string;

  @ApiPropertyOptional({
    enum: CourseMaterialType,
    example: CourseMaterialType.LINK,
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(CourseMaterialType, { message: MATERIAL_TYPE_MESSAGE })
  type?: CourseMaterialType;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: MATERIAL_BODY_MAX_LENGTH,
    description:
      'null очищає текст. Для LINK і VIDEO після зміни має лишитися http(s) адреса.',
  })
  @Transform(emptyToNull)
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsPlainText()
  @MaxLength(MATERIAL_BODY_MAX_LENGTH, {
    message: MATERIAL_BODY_LENGTH_MESSAGE,
  })
  @IsString({ message: 'body має бути рядком або null.' })
  body?: string | null;

  @ApiPropertyOptional({
    example: 2,
    minimum: 1,
    description: 'Нова позиція серед матеріалів цього уроку.',
  })
  @Transform(integerValue)
  @ValidateIf((_, value) => value !== undefined)
  @Min(1, { message: POSITION_MIN_MESSAGE })
  @IsInt({ message: POSITION_INTEGER_MESSAGE })
  position?: number;
}
