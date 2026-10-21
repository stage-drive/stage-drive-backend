import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CarStatus,
  InvitationStatus,
  LicenseCategory,
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
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  PASSWORD_STRENGTH_MESSAGE,
  PASSWORD_STRENGTH_REGEX,
} from '../../common/validators/password-strength';
import { IsPlainText } from '../../common/validators/plain-text.decorator';

const PHONE_REGEX = /^\+?[0-9\s-]{7,20}$/;

export class PublicUserDto {
  @ApiProperty({ example: '22222222-2222-2222-2222-222222222222' })
  id: string;

  @ApiProperty({ example: 'owner@example.com' })
  email: string;

  @ApiProperty({ example: 'Ivan' })
  firstName: string;

  @ApiProperty({ example: 'Petrenko' })
  lastName: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: '+380991234567',
  })
  phone: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  avatarUrl: string | null;

  @ApiProperty({ enum: UserRole, example: UserRole.OWNER })
  role: UserRole;

  @ApiProperty({ example: '11111111-1111-1111-1111-111111111111' })
  organizationId: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Іван' })
  @IsPlainText()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Петренко' })
  @IsPlainText()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  lastName?: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: '+380991234567',
  })
  @IsOptional()
  @Matches(PHONE_REGEX, { message: 'phone must be a valid phone number' })
  phone?: string | null;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'SecurePassword123' })
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({ minLength: 8, example: 'SecurePassword123!' })
  @Matches(PASSWORD_STRENGTH_REGEX, { message: PASSWORD_STRENGTH_MESSAGE })
  @MaxLength(72, { message: 'Пароль занадто довгий.' })
  @MinLength(8, { message: 'Пароль має містити щонайменше 8 символів.' })
  @IsString()
  newPassword: string;
}

export class ChangeEmailDto {
  @ApiProperty({ example: 'new.owner@example.com' })
  @IsEmail({}, { message: 'Введіть коректний email.' })
  @MaxLength(255)
  @IsNotEmpty()
  newEmail: string;

  @ApiProperty({ example: 'SecurePassword123!' })
  @IsString()
  @IsNotEmpty()
  currentPassword: string;
}

export class VerifyEmailDto {
  @ApiProperty({
    description: 'Токен із посилання в листі (/confirm-email?token=...)',
  })
  @IsString()
  @IsNotEmpty()
  token: string;
}

export class MessageResponseDto {
  @ApiProperty({ example: 'Password updated' })
  message: string;
}

export const MEMBER_SORT_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'role',
  'status',
  'createdAt',
] as const;

export type MemberSortField = (typeof MEMBER_SORT_FIELDS)[number];

export const MEMBER_SORT_ORDERS = ['asc', 'desc'] as const;

export type MemberSortOrder = (typeof MEMBER_SORT_ORDERS)[number];

export const MEMBER_STATUS_VALUES = [
  UserStatus.ACTIVE,
  UserStatus.BLOCKED,
  UserStatus.ARCHIVED,
] as const;

const SEARCH_MAX_LENGTH = 100;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_PAGE = 10_000;
const MAX_LIMIT = 100;
const MEMBER_REQUIRED_FIELD_MESSAGE = "Заповніть обов'язкове поле.";

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

export class ListOrganizationMembersQueryDto {
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
    enum: UserRole,
    description:
      'Фільтр за роллю. OWNER може передати ADMIN, TEACHER, INSTRUCTOR або STUDENT. ' +
      'ADMIN — лише TEACHER, INSTRUCTOR або STUDENT.',
    example: UserRole.INSTRUCTOR,
  })
  @IsOptional()
  @IsEnum(UserRole, {
    message: 'role має бути OWNER, ADMIN, TEACHER, INSTRUCTOR або STUDENT.',
  })
  role?: UserRole;

  @ApiPropertyOptional({
    enum: UserStatus,
    description:
      'Фільтр за статусом. Без параметра повертаються INVITED, ACTIVE, BLOCKED і ARCHIVED.',
    example: UserStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(UserStatus, {
    message: 'status має бути INVITED, ACTIVE, BLOCKED або ARCHIVED.',
  })
  status?: UserStatus;

  @ApiPropertyOptional({
    enum: MEMBER_SORT_FIELDS,
    default: 'lastName',
    description: 'Поле сортування. За замовчуванням lastName.',
  })
  @IsOptional()
  @IsIn(MEMBER_SORT_FIELDS, {
    message:
      'sortBy має бути firstName, lastName, email, phone, role, status або createdAt.',
  })
  sortBy?: MemberSortField;

  @ApiPropertyOptional({
    enum: MEMBER_SORT_ORDERS,
    default: 'asc',
    description: 'Напрям сортування. За замовчуванням asc.',
  })
  @IsOptional()
  @IsIn(MEMBER_SORT_ORDERS, { message: 'sortOrder має бути asc або desc.' })
  sortOrder?: MemberSortOrder;

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

export class MemberCarDto {
  @ApiProperty({ example: '31313131-3131-4131-8131-313131313131' })
  id: string;

  @ApiProperty({ example: 'AA1234BB' })
  plateNumber: string;

  @ApiProperty({ enum: LicenseCategory, example: LicenseCategory.B })
  category: LicenseCategory;

  @ApiProperty({ enum: Transmission, example: Transmission.MANUAL })
  transmission: Transmission;

  @ApiProperty({ enum: CarStatus, example: CarStatus.AVAILABLE })
  status: CarStatus;
}

export class MemberInvitationRefDto {
  @ApiProperty({ example: '88888888-8888-4888-8888-888888888888' })
  id: string;

  @ApiProperty({
    enum: InvitationStatus,
    example: InvitationStatus.PENDING,
    description:
      'PENDING — лист ще можна скасувати або надіслати повторно. ' +
      'ACCEPTED — учасник уже активував акаунт. CANCELLED — запрошення скасоване.',
  })
  status: InvitationStatus;

  @ApiProperty()
  expiresAt: Date;
}

export class OrganizationMemberDto {
  @ApiProperty({ example: '77777777-7777-4777-8777-777777777777' })
  id: string;

  @ApiProperty({ example: 'Олена' })
  firstName: string;

  @ApiProperty({ example: 'Коваль' })
  lastName: string;

  @ApiProperty({ example: 'instructor@example.com' })
  email: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: '+380991234567',
  })
  phone: string | null;

  @ApiProperty({ enum: UserRole, example: UserRole.INSTRUCTOR })
  role: UserRole;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status: UserStatus;

  @ApiProperty({ example: '11111111-1111-4111-8111-111111111111' })
  organizationId: string;

  @ApiProperty({
    type: [MemberCarDto],
    description:
      'Автомобілі, де цей користувач записаний інструктором. ' +
      'Для ролей, крім INSTRUCTOR, завжди порожній масив. ' +
      'Призначити, змінити або зняти автомобіль: PATCH /api/cars/{carId}/instructor.',
  })
  cars: MemberCarDto[];

  @ApiProperty({
    nullable: true,
    type: MemberInvitationRefDto,
    description:
      'Останнє запрошення цього користувача. null, якщо акаунт створено без запрошення. ' +
      'Для статусу INVITED id використовується в POST /api/invitations/{id}/cancel і /resend. ' +
      'Сирого token тут немає.',
  })
  invitation: MemberInvitationRefDto | null;
}

export class OrganizationMemberPaginationDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 1 })
  total: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}

export class OrganizationMemberListDto {
  @ApiProperty({ type: [OrganizationMemberDto] })
  users: OrganizationMemberDto[];

  @ApiProperty({ type: OrganizationMemberPaginationDto })
  pagination: OrganizationMemberPaginationDto;
}

export class UpdateOrganizationMemberDto {
  @ApiPropertyOptional({ example: 'Олена' })
  @MaxLength(60, { message: 'Ім’я має містити не більше 60 символів.' })
  @IsPlainText()
  @IsString({ message: 'firstName має бути рядком.' })
  @IsNotEmpty({ message: MEMBER_REQUIRED_FIELD_MESSAGE })
  @IsOptional()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Коваль' })
  @MaxLength(60, { message: 'Прізвище має містити не більше 60 символів.' })
  @IsPlainText()
  @IsString({ message: 'lastName має бути рядком.' })
  @IsNotEmpty({ message: MEMBER_REQUIRED_FIELD_MESSAGE })
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
}

export class UpdateOrganizationMemberStatusDto {
  @ApiProperty({
    enum: MEMBER_STATUS_VALUES,
    example: UserStatus.BLOCKED,
    description:
      'Новий обліковий статус. INVITED задати не можна: ' +
      'активація — POST /api/invitations/activate, ' +
      'скасування запрошення — POST /api/invitations/{id}/cancel.',
  })
  @IsIn(MEMBER_STATUS_VALUES, {
    message: 'status має бути ACTIVE, BLOCKED або ARCHIVED.',
  })
  status: UserStatus;
}
