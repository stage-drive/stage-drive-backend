import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GroupStatus, TrainingStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { IsPlainText } from '../../common/validators/plain-text.decorator';

export const GROUP_NAME_MAX_LENGTH = 120;
export const REQUIRED_FIELD_MESSAGE = "Заповніть обов'язкове поле.";
export const GROUP_NAME_LENGTH_MESSAGE = `Назва має містити не більше ${GROUP_NAME_MAX_LENGTH} символів.`;
export const DATE_FORMAT_MESSAGE = 'Дата має бути у форматі YYYY-MM-DD.';
export const GROUP_STATUS_VALUE_MESSAGE =
  'status має бути PLANNED, ACTIVE, COMPLETED або ARCHIVED.';
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class GroupTeacherDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Ірина' })
  firstName: string;

  @ApiProperty({ example: 'Мельник' })
  lastName: string;
}

export class GroupCourseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Теоретичний курс, категорія B' })
  name: string;
}

export class GroupListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'ПДР — Група А' })
  name: string;

  @ApiProperty({ enum: GroupStatus, example: GroupStatus.ACTIVE })
  status: GroupStatus;

  @ApiProperty({ type: Date, nullable: true })
  startDate: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  endDate: Date | null;

  @ApiProperty({ type: GroupTeacherDto })
  teacher: GroupTeacherDto;

  @ApiProperty({
    type: GroupCourseDto,
    nullable: true,
    description: 'Теоретичний курс групи. null, якщо курс не призначено.',
  })
  course: GroupCourseDto | null;

  @ApiProperty({
    description:
      'Кількість студентів з активним зарахуванням (Enrollment.status = ACTIVE).',
    example: 12,
  })
  studentsCount: number;

  @ApiProperty()
  createdAt: Date;
}

export class GroupListDto {
  @ApiProperty({ type: [GroupListItemDto] })
  groups: GroupListItemDto[];
}

export class CreateGroupDto {
  @ApiProperty({
    example: 'ПДР — Група А',
    maxLength: GROUP_NAME_MAX_LENGTH,
    description:
      'Пробіли по краях обрізаються. Унікальна серед відкритих груп автошколи без урахування регістру.',
  })
  @Transform(trimString)
  @IsPlainText()
  @MaxLength(GROUP_NAME_MAX_LENGTH, { message: GROUP_NAME_LENGTH_MESSAGE })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'name має бути рядком.' })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  name: string;

  @ApiProperty({
    format: 'uuid',
    example: 'a3b2c1d0-0000-4000-8000-000000000000',
    description:
      'Викладач тієї самої автошколи з роллю TEACHER і статусом ACTIVE.',
  })
  @IsUUID('4', { message: 'teacherId має бути UUID.' })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  teacherId: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-11-01' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: DATE_FORMAT_MESSAGE })
  @Matches(DATE_ONLY_PATTERN, { message: DATE_FORMAT_MESSAGE })
  startDate?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2027-01-31',
    description: 'Не раніше startDate.',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: DATE_FORMAT_MESSAGE })
  @Matches(DATE_ONLY_PATTERN, { message: DATE_FORMAT_MESSAGE })
  endDate?: string;
}

export class UpdateGroupDto {
  @ApiPropertyOptional({
    example: 'ПДР — Група А (вечірня)',
    maxLength: GROUP_NAME_MAX_LENGTH,
    description:
      'Пробіли по краях обрізаються. Унікальна серед відкритих груп автошколи без урахування регістру.',
  })
  @Transform(trimString)
  @ValidateIf((_, value) => value !== undefined)
  @IsPlainText()
  @MaxLength(GROUP_NAME_MAX_LENGTH, { message: GROUP_NAME_LENGTH_MESSAGE })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'name має бути рядком.' })
  name?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: 'a3b2c1d0-0000-4000-8000-000000000000',
    description:
      'Новий викладач: TEACHER зі статусом ACTIVE тієї самої автошколи.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID('4', { message: 'teacherId має бути UUID.' })
  teacherId?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: true,
    example: '2026-11-01',
    description: 'null очищає дату.',
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsISO8601({ strict: true }, { message: DATE_FORMAT_MESSAGE })
  @Matches(DATE_ONLY_PATTERN, { message: DATE_FORMAT_MESSAGE })
  startDate?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: true,
    example: '2027-01-31',
    description: 'Не раніше startDate. null очищає дату.',
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsISO8601({ strict: true }, { message: DATE_FORMAT_MESSAGE })
  @Matches(DATE_ONLY_PATTERN, { message: DATE_FORMAT_MESSAGE })
  endDate?: string | null;
}

export class UpdateGroupStatusDto {
  @ApiProperty({
    enum: GroupStatus,
    example: GroupStatus.ACTIVE,
    description:
      'Новий статус групи. Дозволені переходи: ' +
      'PLANNED → ACTIVE, ARCHIVED; ' +
      'ACTIVE → COMPLETED, ARCHIVED; ' +
      'COMPLETED → ARCHIVED. ' +
      'Зі статусу ARCHIVED і назад у PLANNED чи ACTIVE перейти не можна.',
  })
  @IsEnum(GroupStatus, { message: GROUP_STATUS_VALUE_MESSAGE })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  status: GroupStatus;
}

export class AssignGroupCourseDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: '41414141-4141-4414-8414-414141414141',
    description: 'Активний курс своєї автошколи. null знімає курс.',
  })
  // Коли courseId === null, пропускаються і @IsUUID, і @IsDefined.
  @ValidateIf((_, value) => value !== null)
  @IsUUID('4', { message: 'courseId має бути UUID або null.' })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  courseId: string | null;
}

export class AddGroupStudentDto {
  @ApiProperty({
    format: 'uuid',
    example: '88888888-8888-4888-8888-888888888888',
    description:
      'Id користувача-студента тієї самої автошколи. Студент не може бути в іншій відкритій групі.',
  })
  @IsUUID('4', { message: 'studentId має бути UUID.' })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  studentId: string;
}

export class GroupStudentDto {
  @ApiProperty({ description: 'Id користувача-студента.' })
  id: string;

  @ApiProperty({ example: 'Олена' })
  firstName: string;

  @ApiProperty({ example: 'Коваль' })
  lastName: string;

  @ApiProperty({ example: 'student@example.com' })
  email: string;

  @ApiProperty({ type: String, nullable: true, example: '+380991234567' })
  phone: string | null;

  @ApiProperty({ enum: TrainingStatus, nullable: true })
  trainingStatus: TrainingStatus | null;

  @ApiProperty({ description: 'Коли студента зараховано в групу.' })
  enrolledAt: Date;
}

export class GroupStudentsDto {
  @ApiProperty({
    type: GroupListItemDto,
    description: 'Група з актуальним studentsCount.',
  })
  group: GroupListItemDto;

  @ApiProperty({
    type: [GroupStudentDto],
    description:
      'Студенти з активним зарахуванням, відсортовані за прізвищем та ім’ям.',
  })
  students: GroupStudentDto[];
}
