import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LicenseCategory, Transmission } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsDefined,
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
  ValidateIf,
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

export const PLATE_MAX_LENGTH = 16;
export const REQUIRED_FIELD_MESSAGE = "Заповніть обов'язкове поле.";
export const PLATE_FORMAT_MESSAGE =
  'Номер має містити лише латинські літери та цифри.';
export const PLATE_LENGTH_MESSAGE = `Номер має містити не більше ${PLATE_MAX_LENGTH} символів.`;
export const PLATE_PATTERN = /^[A-Z0-9]+$/;

export function normalizePlateNumber(value: string): string {
  return value.replace(/[\s-]+/g, '').toUpperCase();
}

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

function normalizePlateInput({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  return normalizePlateNumber(value);
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

export class CreateCarDto {
  @ApiProperty({
    example: 'AA0003BB',
    maxLength: PLATE_MAX_LENGTH,
    description:
      'Державний номер. Пробіли і дефіси прибираються, літери переводяться у верхній регістр. Унікальний у межах автошколи.',
  })
  @Transform(normalizePlateInput)
  @MaxLength(PLATE_MAX_LENGTH, { message: PLATE_LENGTH_MESSAGE })
  @Matches(PLATE_PATTERN, { message: PLATE_FORMAT_MESSAGE })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'plateNumber має бути рядком.' })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  plateNumber: string;

  @ApiProperty({
    enum: LicenseCategory,
    example: LicenseCategory.B,
    description: 'Категорія, для якої використовується автомобіль.',
  })
  @IsEnum(LicenseCategory, {
    message: 'category має бути A, B, C або D.',
  })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  category: LicenseCategory;

  @ApiProperty({
    enum: Transmission,
    example: Transmission.MANUAL,
    description: 'Коробка передач.',
  })
  @IsEnum(Transmission, {
    message: 'transmission має бути MANUAL або AUTOMATIC.',
  })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  transmission: Transmission;

  @ApiProperty({
    format: 'uuid',
    example: '23232323-2323-4232-8232-232323232323',
    description:
      'Інструктор тієї самої автошколи з роллю INSTRUCTOR і статусом ACTIVE.',
  })
  @IsUUID('4', { message: 'instructorId має бути UUID.' })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  instructorId: string;
}

export class UpdateCarDto {
  @ApiPropertyOptional({
    example: 'AA0009BB',
    maxLength: PLATE_MAX_LENGTH,
    description:
      'Новий державний номер. Пробіли і дефіси прибираються, літери переводяться у верхній регістр.',
  })
  @Transform(normalizePlateInput)
  @ValidateIf((_, value) => value !== undefined)
  @MaxLength(PLATE_MAX_LENGTH, { message: PLATE_LENGTH_MESSAGE })
  @Matches(PLATE_PATTERN, { message: PLATE_FORMAT_MESSAGE })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'plateNumber має бути рядком.' })
  plateNumber?: string;

  @ApiPropertyOptional({
    enum: LicenseCategory,
    example: LicenseCategory.B,
    description:
      'Нова категорія. Якщо автомобіль уже призначено студенту, значення має збігатися з його профілем.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(LicenseCategory, {
    message: 'category має бути A, B, C або D.',
  })
  category?: LicenseCategory;

  @ApiPropertyOptional({
    enum: Transmission,
    example: Transmission.AUTOMATIC,
    description:
      'Нова коробка передач. Має збігатися зі студентом, якому вже призначено цей автомобіль.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(Transmission, {
    message: 'transmission має бути MANUAL або AUTOMATIC.',
  })
  transmission?: Transmission;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '23232323-2323-4232-8232-232323232323',
    description:
      'Новий інструктор тієї самої автошколи з роллю INSTRUCTOR і статусом ACTIVE.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID('4', { message: 'instructorId має бути UUID.' })
  instructorId?: string;
}
