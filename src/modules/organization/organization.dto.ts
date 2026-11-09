import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { IsPlainText } from '../../common/validators/plain-text.decorator';

export const ORGANIZATION_NAME_MAX_LENGTH = 120;
export const ORGANIZATION_EMAIL_MAX_LENGTH = 255;
export const ORGANIZATION_PHONE_MAX_LENGTH = 20;
export const ORGANIZATION_ADDRESS_MAX_LENGTH = 255;

export const ORGANIZATION_REQUIRED_FIELD_MESSAGE =
  "Заповніть обов'язкове поле.";
export const ORGANIZATION_EMAIL_MESSAGE = 'Введіть коректний email.';
export const ORGANIZATION_PHONE_MESSAGE = 'Введіть коректний номер телефону.';

const PHONE_REGEX = /^\+?[0-9\s-]{7,20}$/;

function trimmed({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function trimmedLowercase({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

/**
 * multipart/form-data не передає null, тож порожній рядок теж очищає поле.
 */
function trimmedOrNull({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const result = value.trim();
  return result.length > 0 ? result : null;
}

/** Обов'язкове поле: можна не передавати, але не можна очистити. */
function isProvided(_object: unknown, value: unknown): boolean {
  return value !== undefined;
}

export class PublicOrganizationDto {
  @ApiProperty({ example: '11111111-1111-1111-1111-111111111111' })
  id: string;

  @ApiProperty({ example: 'Stage Drive School' })
  name: string;

  @ApiProperty({ example: 'info@stagedrive.ua' })
  email: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: '+380441234567',
  })
  phone: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: 'м. Київ, вул. Хрещатик, 1',
  })
  address: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  logoUrl: string | null;

  @ApiProperty({
    example: 'Europe/Kyiv',
    description: 'Лише для читання: від нього залежить розклад занять.',
  })
  timezone: string;
}

/**
 * Поля, які OWNER і ADMIN змінюють у налаштуваннях автошколи.
 * timezone, status, slug та інші поля сюди не входять, тож глобальний
 * ValidationPipe (forbidNonWhitelisted) відхиляє запит, у якому вони є.
 */
export class UpdateOrganizationDto {
  @ApiPropertyOptional({
    example: 'Автошкола Drive',
    maxLength: ORGANIZATION_NAME_MAX_LENGTH,
  })
  @Transform(trimmed)
  @MaxLength(ORGANIZATION_NAME_MAX_LENGTH, {
    message: `Назва має містити не більше ${ORGANIZATION_NAME_MAX_LENGTH} символів.`,
  })
  @IsPlainText()
  @IsString({ message: 'name має бути рядком.' })
  @IsNotEmpty({ message: ORGANIZATION_REQUIRED_FIELD_MESSAGE })
  @ValidateIf(isProvided)
  name?: string;

  @ApiPropertyOptional({
    example: 'info@stagedrive.ua',
    maxLength: ORGANIZATION_EMAIL_MAX_LENGTH,
  })
  @Transform(trimmedLowercase)
  @MaxLength(ORGANIZATION_EMAIL_MAX_LENGTH, {
    message: `Email має містити не більше ${ORGANIZATION_EMAIL_MAX_LENGTH} символів.`,
  })
  @IsEmail({}, { message: ORGANIZATION_EMAIL_MESSAGE })
  @IsString({ message: 'email має бути рядком.' })
  @IsNotEmpty({ message: ORGANIZATION_REQUIRED_FIELD_MESSAGE })
  @ValidateIf(isProvided)
  email?: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: '+380441234567',
    description: 'null або порожній рядок очищає телефон.',
  })
  @Transform(trimmedOrNull)
  @MaxLength(ORGANIZATION_PHONE_MAX_LENGTH, {
    message: ORGANIZATION_PHONE_MESSAGE,
  })
  @Matches(PHONE_REGEX, { message: ORGANIZATION_PHONE_MESSAGE })
  @IsString({ message: 'phone має бути рядком або null.' })
  @IsOptional()
  phone?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: 'м. Київ, вул. Хрещатик, 1',
    maxLength: ORGANIZATION_ADDRESS_MAX_LENGTH,
    description: 'null або порожній рядок очищає адресу.',
  })
  @Transform(trimmedOrNull)
  @MaxLength(ORGANIZATION_ADDRESS_MAX_LENGTH, {
    message: `Адреса має містити не більше ${ORGANIZATION_ADDRESS_MAX_LENGTH} символів.`,
  })
  @IsPlainText()
  @IsString({ message: 'address має бути рядком або null.' })
  @IsOptional()
  address?: string | null;
}
