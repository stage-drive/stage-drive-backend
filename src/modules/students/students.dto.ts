import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole, UserStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

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
