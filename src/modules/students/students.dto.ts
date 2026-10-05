import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  InvitationStatus,
  LicenseCategory,
  TrainingStatus,
  Transmission,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsPlainText } from '../../common/validators/plain-text.decorator';
import { InvitationEmailDeliveryDto } from '../invitations/invitations.dto';

export const STUDENT_SORT_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'status',
  'createdAt',
] as const;

export type StudentSortField = (typeof STUDENT_SORT_FIELDS)[number];

export const SORT_ORDERS = ['asc', 'desc'] as const;

export type StudentSortOrder = (typeof SORT_ORDERS)[number];

const SEARCH_MAX_LENGTH = 100;
const PHONE_REGEX = /^\+?[0-9\s-]{7,20}$/;
const REQUIRED_FIELD_MESSAGE = "Заповніть обов'язкове поле.";
const INVALID_EMAIL_MESSAGE = 'Введіть коректний email.';
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_PAGE = 10_000;
const MAX_LIMIT = 100;

function optionalTrimmedString({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalInteger({ value }: { value: unknown }): unknown {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return typeof value === 'number' ? value : Number(value);
}

export class ListStudentsQueryDto {
  @ApiPropertyOptional({
    description:
      'Пошук за ім’ям, прізвищем, email або телефоном. Пробіл шукає ім’я і прізвище разом.',
    example: 'Петренко',
    maxLength: SEARCH_MAX_LENGTH,
  })
  @Transform(optionalTrimmedString)
  @IsOptional()
  @IsString({ message: 'search має бути рядком.' })
  @MaxLength(SEARCH_MAX_LENGTH, {
    message: `search має містити не більше ${SEARCH_MAX_LENGTH} символів.`,
  })
  search?: string;

  @ApiPropertyOptional({
    enum: UserStatus,
    description: 'Фільтр за статусом студента.',
    example: UserStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(UserStatus, {
    message: 'status має бути INVITED, ACTIVE, BLOCKED або ARCHIVED.',
  })
  status?: UserStatus;

  @ApiPropertyOptional({
    enum: STUDENT_SORT_FIELDS,
    default: 'lastName',
    description: 'Поле сортування. За замовчуванням lastName.',
  })
  @IsOptional()
  @IsIn(STUDENT_SORT_FIELDS, {
    message:
      'sortBy має бути firstName, lastName, email, phone, status або createdAt.',
  })
  sortBy?: StudentSortField;

  @ApiPropertyOptional({
    enum: SORT_ORDERS,
    default: 'asc',
    description: 'Напрям сортування. За замовчуванням asc.',
  })
  @IsOptional()
  @IsIn(SORT_ORDERS, { message: 'sortOrder має бути asc або desc.' })
  sortOrder?: StudentSortOrder;

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

export class StudentListItemDto {
  @ApiProperty({ example: '77777777-7777-7777-7777-777777777777' })
  id: string;

  @ApiProperty({ example: 'student@example.com' })
  email: string;

  @ApiProperty({ example: 'Олена' })
  firstName: string;

  @ApiProperty({ example: 'Коваль' })
  lastName: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: '+380991234567',
  })
  phone: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  avatarUrl: string | null;

  @ApiProperty({ enum: UserRole, example: UserRole.STUDENT })
  role: UserRole;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status: UserStatus;

  @ApiProperty({ example: '11111111-1111-1111-1111-111111111111' })
  organizationId: string;

  @ApiProperty({ example: '2026-01-02T00:00:00.000Z' })
  createdAt: Date;
}

export class StudentListPaginationDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 1 })
  total: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}

export class StudentListDto {
  @ApiProperty({ type: [StudentListItemDto] })
  students: StudentListItemDto[];

  @ApiProperty({ type: StudentListPaginationDto })
  pagination: StudentListPaginationDto;
}

export class CreateStudentDto {
  @ApiProperty({ example: 'Олена' })
  @MaxLength(60)
  @IsPlainText()
  @IsString()
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  firstName: string;

  @ApiProperty({ example: 'Коваль' })
  @MaxLength(60)
  @IsPlainText()
  @IsString()
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  lastName: string;

  @ApiProperty({ example: 'student@example.com' })
  @IsEmail({}, { message: INVALID_EMAIL_MESSAGE })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  email: string;

  @ApiPropertyOptional({
    example: '+380991234567',
    nullable: true,
  })
  @Matches(PHONE_REGEX, { message: 'Введіть коректний номер телефону.' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({
    description:
      'Група своєї автошколи зі статусом PLANNED або ACTIVE. ' +
      'Якщо поле не передати, учень створюється без групи. ' +
      'Разом із groupId створюється активне зарахування.',
    example: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  })
  @IsUUID('4', { message: 'groupId має бути UUID.' })
  @IsOptional()
  groupId?: string;

  @ApiPropertyOptional({
    enum: LicenseCategory,
    nullable: true,
    description:
      'Категорія, на яку навчається студент. Потрібна разом із transmission для допуску до практики.',
    example: LicenseCategory.B,
  })
  @IsEnum(LicenseCategory, {
    message: 'category має бути A, B, C або D.',
  })
  @IsOptional()
  category?: LicenseCategory | null;

  @ApiPropertyOptional({
    enum: Transmission,
    nullable: true,
    description:
      'Коробка передач, на яку навчається студент. Має збігатися з автомобілем допуску.',
    example: Transmission.MANUAL,
  })
  @IsEnum(Transmission, {
    message: 'transmission має бути MANUAL або AUTOMATIC.',
  })
  @IsOptional()
  transmission?: Transmission | null;
}

export class CreatedStudentUserDto {
  @ApiProperty({ example: '77777777-7777-7777-7777-777777777777' })
  id: string;

  @ApiProperty({ example: 'Олена' })
  firstName: string;

  @ApiProperty({ example: 'Коваль' })
  lastName: string;

  @ApiProperty({ example: 'student@example.com' })
  email: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  phone: string | null;

  @ApiProperty({ enum: UserRole, example: UserRole.STUDENT })
  role: UserRole;

  @ApiProperty({ enum: UserStatus, example: UserStatus.INVITED })
  status: UserStatus;

  @ApiProperty({ example: '11111111-1111-1111-1111-111111111111' })
  organizationId: string;
}

export class StudentProfileDto {
  @ApiProperty({ example: '12121212-1212-1212-1212-121212121212' })
  id: string;

  @ApiProperty({ example: '77777777-7777-7777-7777-777777777777' })
  userId: string;

  @ApiProperty({ example: '11111111-1111-1111-1111-111111111111' })
  organizationId: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  })
  groupId: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'null, доки ADMIN не надасть допуск до практики через PATCH /api/students/{id}/practice-access.',
  })
  instructorId: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'null, доки ADMIN не надасть допуск до практики через PATCH /api/students/{id}/practice-access.',
  })
  carId: string | null;

  @ApiProperty({
    enum: LicenseCategory,
    nullable: true,
    example: LicenseCategory.B,
    description:
      'Категорія, на яку навчається студент. Потрібна для допуску до практики. ' +
      'Новий учень створюється з null.',
  })
  category: LicenseCategory | null;

  @ApiProperty({
    enum: Transmission,
    nullable: true,
    example: Transmission.MANUAL,
    description:
      'Коробка передач, на яку навчається студент. Має збігатися з автомобілем допуску. ' +
      'Новий учень створюється з null.',
  })
  transmission: Transmission | null;

  @ApiProperty({
    enum: TrainingStatus,
    example: TrainingStatus.INVITED,
    description:
      'Навчальний статус. Новий учень створюється як INVITED. ' +
      'PRACTICE встановлюється лише через PATCH /api/students/{id}/practice-access. ' +
      'Інші переходи — через PATCH /api/students/{id}/status.',
  })
  trainingStatus: TrainingStatus;
}

export class CreatedStudentInvitationDto {
  @ApiProperty({ example: '44444444-4444-4444-4444-444444444444' })
  id: string;

  @ApiProperty({ example: 'student@example.com' })
  email: string;

  @ApiProperty({ enum: UserRole, example: UserRole.STUDENT })
  role: UserRole;

  @ApiProperty({ enum: InvitationStatus, example: InvitationStatus.PENDING })
  status: InvitationStatus;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty({ example: '77777777-7777-7777-7777-777777777777' })
  userId: string;

  @ApiProperty({ example: '11111111-1111-1111-1111-111111111111' })
  organizationId: string;

  @ApiProperty({ type: InvitationEmailDeliveryDto })
  emailDelivery: InvitationEmailDeliveryDto;
}

export class CreateStudentResponseDto {
  @ApiProperty({ type: CreatedStudentUserDto })
  user: CreatedStudentUserDto;

  @ApiProperty({ type: StudentProfileDto })
  student: StudentProfileDto;

  @ApiProperty({ type: CreatedStudentInvitationDto })
  invitation: CreatedStudentInvitationDto;
}

export class UpdateStudentTrainingStatusDto {
  @ApiProperty({
    enum: TrainingStatus,
    example: TrainingStatus.ACTIVE,
    description:
      'Новий навчальний статус. Дозволені переходи: ' +
      'INVITED → ACTIVE, DROPPED, ARCHIVED; ' +
      'ACTIVE → GRADUATED, DROPPED, ARCHIVED; ' +
      'PRACTICE → GRADUATED, DROPPED, ARCHIVED; ' +
      'GRADUATED → ARCHIVED; DROPPED → ARCHIVED. ' +
      'ARCHIVED далі не змінюється. ' +
      'PRACTICE цим запитом не призначається.',
  })
  @IsEnum(TrainingStatus, {
    message:
      'status має бути INVITED, ACTIVE, PRACTICE, GRADUATED, DROPPED або ARCHIVED.',
  })
  status: TrainingStatus;
}

export class AssignStudentGroupDto {
  @ApiProperty({
    description:
      'Навчальна група тієї самої автошколи. Групи ARCHIVED і COMPLETED не приймаються.',
    example: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  })
  @IsUUID('4', { message: 'groupId має бути UUID.' })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  groupId: string;
}

export class GrantPracticeAccessDto {
  @ApiProperty({
    description:
      'Інструктор тієї самої автошколи з роллю INSTRUCTOR і статусом ACTIVE.',
    example: '23232323-2323-4232-8232-232323232323',
  })
  @IsUUID('4', { message: 'instructorId має бути UUID.' })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  instructorId: string;

  @ApiProperty({
    description:
      'Автомобіль цього інструктора. category і transmission мають збігатися зі студентом.',
    example: '31313131-3131-4131-8131-313131313131',
  })
  @IsUUID('4', { message: 'carId має бути UUID.' })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  carId: string;
}

export class UpdateStudentDto {
  @ApiPropertyOptional({ example: 'Олена' })
  @MaxLength(60, { message: 'Ім’я має містити не більше 60 символів.' })
  @IsPlainText()
  @IsString({ message: 'firstName має бути рядком.' })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsOptional()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Коваль' })
  @MaxLength(60, { message: 'Прізвище має містити не більше 60 символів.' })
  @IsPlainText()
  @IsString({ message: 'lastName має бути рядком.' })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsOptional()
  lastName?: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: '+380991234567',
    description: 'Передайте null, щоб очистити телефон.',
  })
  @Matches(PHONE_REGEX, { message: 'Введіть коректний номер телефону.' })
  @IsString({ message: 'phone має бути рядком або null.' })
  @IsOptional()
  phone?: string | null;

  @ApiPropertyOptional({
    enum: LicenseCategory,
    nullable: true,
    description:
      'Категорія навчання. null очищує значення. ' +
      'Якщо студенту вже призначено автомобіль, нова пара category/transmission має з ним збігатися.',
    example: LicenseCategory.B,
  })
  @IsEnum(LicenseCategory, {
    message: 'category має бути A, B, C або D.',
  })
  @IsOptional()
  category?: LicenseCategory | null;

  @ApiPropertyOptional({
    enum: Transmission,
    nullable: true,
    description:
      'Коробка передач. null очищує значення. ' +
      'Має збігатися з уже призначеним автомобілем.',
    example: Transmission.MANUAL,
  })
  @IsEnum(Transmission, {
    message: 'transmission має бути MANUAL або AUTOMATIC.',
  })
  @IsOptional()
  transmission?: Transmission | null;
}

export class StudentCardDto {
  @ApiProperty({
    example: '88888888-8888-4888-8888-888888888888',
    description: 'Id користувача. Той самий id, що в списку студентів.',
  })
  id: string;

  @ApiProperty({ example: 'student@example.com' })
  email: string;

  @ApiProperty({ example: 'Олена' })
  firstName: string;

  @ApiProperty({ example: 'Коваль' })
  lastName: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: '+380991234567',
  })
  phone: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  avatarUrl: string | null;

  @ApiProperty({ enum: UserRole, example: UserRole.STUDENT })
  role: UserRole;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status: UserStatus;

  @ApiProperty({ example: '11111111-1111-1111-1111-111111111111' })
  organizationId: string;

  @ApiProperty({ example: '2026-01-02T00:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-02-01T00:00:00.000Z' })
  updatedAt: Date;

  @ApiPropertyOptional({
    nullable: true,
    type: StudentProfileDto,
    description:
      'Профіль учня. null, якщо рядок у таблиці students ще не створений.',
  })
  student: StudentProfileDto | null;
}
