import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CourseStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsDefined,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { IsPlainText } from '../../common/validators/plain-text.decorator';

export const COURSE_NAME_MAX_LENGTH = 120;
export const COURSE_DESCRIPTION_MAX_LENGTH = 2000;
export const REQUIRED_FIELD_MESSAGE = "Заповніть обов'язкове поле.";
export const COURSE_NAME_LENGTH_MESSAGE = `Назва має містити не більше ${COURSE_NAME_MAX_LENGTH} символів.`;
export const COURSE_DESCRIPTION_LENGTH_MESSAGE = `Опис має містити не більше ${COURSE_DESCRIPTION_MAX_LENGTH} символів.`;

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** Порожній опис — це відсутність опису, а не рядок із пробілів. */
function emptyToNull({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export class CourseListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Теоретичний курс, категорія B' })
  name: string;

  @ApiProperty({
    enum: CourseStatus,
    example: CourseStatus.ACTIVE,
    description: 'Групі можна призначити лише ACTIVE-курс.',
  })
  status: CourseStatus;
}

export class CourseListDto {
  @ApiProperty({ type: [CourseListItemDto] })
  courses: CourseListItemDto[];
}

/** Курс після створення або редагування: те, що збережено в організації актора. */
export class CourseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Теоретичний курс, категорія B' })
  name: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'ПДР, основи безпеки руху та будова автомобіля.',
  })
  description: string | null;

  @ApiProperty({
    enum: CourseStatus,
    example: CourseStatus.ACTIVE,
    description:
      'Новий курс завжди ACTIVE. Статус цим ендпоінтом не змінюється.',
  })
  status: CourseStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class CreateCourseDto {
  @ApiProperty({
    example: 'Теоретичний курс, категорія B',
    maxLength: COURSE_NAME_MAX_LENGTH,
    description:
      'Пробіли по краях обрізаються. Унікальна серед ACTIVE-курсів автошколи без урахування регістру.',
  })
  @Transform(trimString)
  @IsPlainText()
  @MaxLength(COURSE_NAME_MAX_LENGTH, { message: COURSE_NAME_LENGTH_MESSAGE })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'name має бути рядком.' })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  name: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: COURSE_DESCRIPTION_MAX_LENGTH,
    example: 'ПДР, основи безпеки руху та будова автомобіля.',
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
}

export class UpdateCourseDto {
  @ApiPropertyOptional({
    example: 'Теоретичний курс, категорія B (вечірня)',
    maxLength: COURSE_NAME_MAX_LENGTH,
    description:
      'Пробіли по краях обрізаються. Унікальна серед ACTIVE-курсів автошколи без урахування регістру.',
  })
  @Transform(trimString)
  @ValidateIf((_, value) => value !== undefined)
  @IsPlainText()
  @MaxLength(COURSE_NAME_MAX_LENGTH, { message: COURSE_NAME_LENGTH_MESSAGE })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'name має бути рядком.' })
  name?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: COURSE_DESCRIPTION_MAX_LENGTH,
    example: 'ПДР та перша допомога.',
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
}
