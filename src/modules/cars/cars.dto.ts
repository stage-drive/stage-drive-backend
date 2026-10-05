import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LicenseCategory, Transmission } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const CAR_SORT_FIELDS = [
  'plateNumber',
  'category',
  'transmission',
  'createdAt',
] as const;

export type CarSortField = (typeof CAR_SORT_FIELDS)[number];

export const CAR_SORT_ORDERS = ['asc', 'desc'] as const;

export type CarSortOrder = (typeof CAR_SORT_ORDERS)[number];

const SEARCH_MAX_LENGTH = 16;
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

export class ListCarsQueryDto {
  @ApiPropertyOptional({
    description: 'Пошук за державним номером.',
    example: 'AA0001',
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
    enum: LicenseCategory,
    description: 'Фільтр за категорією.',
    example: LicenseCategory.B,
  })
  @IsOptional()
  @IsEnum(LicenseCategory, {
    message: 'category має бути A, B, C або D.',
  })
  category?: LicenseCategory;

  @ApiPropertyOptional({
    enum: Transmission,
    description: 'Фільтр за коробкою передач.',
    example: Transmission.MANUAL,
  })
  @IsOptional()
  @IsEnum(Transmission, {
    message: 'transmission має бути MANUAL або AUTOMATIC.',
  })
  transmission?: Transmission;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Фільтр за інструктором своєї автошколи. Для INSTRUCTOR список і так обмежений власними автомобілями.',
    example: '23232323-2323-4232-8232-232323232323',
  })
  @IsOptional()
  @IsUUID('4', { message: 'instructorId має бути UUID.' })
  instructorId?: string;

  @ApiPropertyOptional({
    enum: CAR_SORT_FIELDS,
    default: 'plateNumber',
    description: 'Поле сортування. За замовчуванням plateNumber.',
  })
  @IsOptional()
  @IsIn(CAR_SORT_FIELDS, {
    message:
      'sortBy має бути plateNumber, category, transmission або createdAt.',
  })
  sortBy?: CarSortField;

  @ApiPropertyOptional({
    enum: CAR_SORT_ORDERS,
    default: 'asc',
    description: 'Напрям сортування. За замовчуванням asc.',
  })
  @IsOptional()
  @IsIn(CAR_SORT_ORDERS, { message: 'sortOrder має бути asc або desc.' })
  sortOrder?: CarSortOrder;

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

export class CarInstructorDto {
  @ApiProperty({ example: '23232323-2323-4232-8232-232323232323' })
  id: string;

  @ApiProperty({ example: 'Тарас' })
  firstName: string;

  @ApiProperty({ example: 'Шевченко' })
  lastName: string;
}

export class CarListItemDto {
  @ApiProperty({ example: '31313131-3131-4131-8131-313131313131' })
  id: string;

  @ApiProperty({ example: '11111111-1111-1111-1111-111111111111' })
  organizationId: string;

  @ApiProperty({ example: '23232323-2323-4232-8232-232323232323' })
  instructorId: string;

  @ApiProperty({ type: CarInstructorDto })
  instructor: CarInstructorDto;

  @ApiProperty({ example: 'AA0001BB' })
  plateNumber: string;

  @ApiProperty({ enum: LicenseCategory, example: LicenseCategory.B })
  category: LicenseCategory;

  @ApiProperty({ enum: Transmission, example: Transmission.MANUAL })
  transmission: Transmission;

  @ApiProperty({ example: '2026-01-02T00:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-01-02T00:00:00.000Z' })
  updatedAt: Date;
}

export class CarListPaginationDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 1 })
  total: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}

export class CarListDto {
  @ApiProperty({ type: [CarListItemDto] })
  cars: CarListItemDto[];

  @ApiProperty({ type: CarListPaginationDto })
  pagination: CarListPaginationDto;
}
