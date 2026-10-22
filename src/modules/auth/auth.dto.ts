import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole, UserStatus } from '@prisma/client';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Match } from '../../common/validators/match.decorator';
import {
  PASSWORD_STRENGTH_MESSAGE,
  PASSWORD_STRENGTH_REGEX,
} from '../../common/validators/password-strength';
import { IsPlainText } from '../../common/validators/plain-text.decorator';

const PHONE_REGEX = /^\+?[0-9\s-]{7,20}$/;

const REQUIRED_FIELD_MESSAGE = "Заповніть обов'язкове поле.";
const INVALID_EMAIL_MESSAGE = 'Введіть коректний email.';
const INVALID_PHONE_MESSAGE = 'Введіть коректний номер телефону.';
const PASSWORDS_DO_NOT_MATCH_MESSAGE = 'Паролі не співпадають.';
const TERMS_NOT_ACCEPTED_MESSAGE =
  'Потрібно погодитися з умовами використання.';

function isFieldPresent(_: object, value: unknown): boolean {
  return value !== undefined;
}

// class-validator (legacy TS decorators) registers stacked property decorators
// bottom-to-top, so the bottom-most decorator is evaluated FIRST. With
// `stopAtFirstError: true` on the global pipe, the "required" check must sit
// closest to the property so it wins over format-specific checks on empty input.

export class LoginDto {
  @ApiProperty({ example: 'owner@example.com' })
  @IsEmail({}, { message: INVALID_EMAIL_MESSAGE })
  email: string;

  @ApiProperty({ example: 'SecurePassword123' })
  @IsString()
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  password: string;
}

export class GoogleIdTokenDto {
  @ApiProperty({
    example: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
    description:
      'Google OpenID Connect ID token (JWT). Це не authorization code. ' +
      'У Postman вставте id_token з Google Sign-In / OAuth Playground. ' +
      'Email у токені має збігатися з існуючим користувачем системи.',
  })
  @IsString()
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  idToken: string;
}

export class RegisterDto {
  @ApiProperty({ example: 'Автошкола Drive' })
  @MaxLength(120)
  @IsPlainText()
  @IsString()
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  organizationName: string;

  @ApiProperty({ example: 'Іван' })
  @MaxLength(60)
  @IsPlainText()
  @IsString()
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  firstName: string;

  @ApiProperty({ example: 'Петренко' })
  @MaxLength(60)
  @IsPlainText()
  @IsString()
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  lastName: string;

  @ApiProperty({ example: 'new-owner@example.com' })
  @IsEmail({}, { message: INVALID_EMAIL_MESSAGE })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  email: string;

  @ApiProperty({ example: '+380991234567', required: false, nullable: true })
  @Matches(PHONE_REGEX, { message: INVALID_PHONE_MESSAGE })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({ example: 'SecurePassword123!' })
  @Matches(PASSWORD_STRENGTH_REGEX, { message: PASSWORD_STRENGTH_MESSAGE })
  @MaxLength(72, { message: 'Пароль занадто довгий.' })
  @MinLength(8, { message: 'Пароль має містити щонайменше 8 символів.' })
  @IsString()
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  password: string;

  @ApiProperty({ example: 'SecurePassword123!' })
  @Match('password', { message: PASSWORDS_DO_NOT_MATCH_MESSAGE })
  @IsString()
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  passwordConfirmation: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  @Equals(true, { message: TERMS_NOT_ACCEPTED_MESSAGE })
  termsAccepted: boolean;
}

export class CheckEmailDto {
  @ApiProperty({
    example: 'new-owner@example.com',
    description:
      'Email з форми реєстрації. Пробіли по краях і регістр не створюють окремий акаунт: ' +
      'перед пошуком адреса обрізається і переводиться в нижній регістр.',
  })
  @IsEmail({}, { message: INVALID_EMAIL_MESSAGE })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  email: string;
}

export class EmailAvailabilityResponseDto {
  @ApiProperty({
    example: true,
    description: 'true, якщо формат коректний і email ще не зайнятий.',
  })
  available: boolean;
}

export class ValidateRegistrationFieldsDto {
  @ApiPropertyOptional({ example: 'Автошкола Drive' })
  @ValidateIf(isFieldPresent)
  @MaxLength(120)
  @IsPlainText()
  @IsString()
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  organizationName?: string;

  @ApiPropertyOptional({ example: 'Іван' })
  @ValidateIf(isFieldPresent)
  @MaxLength(60)
  @IsPlainText()
  @IsString()
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  firstName?: string;

  @ApiPropertyOptional({ example: 'Петренко' })
  @ValidateIf(isFieldPresent)
  @MaxLength(60)
  @IsPlainText()
  @IsString()
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  lastName?: string;

  @ApiPropertyOptional({
    example: 'new-owner@example.com',
    description:
      'Якщо поле передано і формат коректний, додатково перевіряється зайнятість email.',
  })
  @ValidateIf(isFieldPresent)
  @IsEmail({}, { message: INVALID_EMAIL_MESSAGE })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  email?: string;

  @ApiPropertyOptional({
    example: '+380991234567',
    nullable: true,
    description:
      'Необов’язкове поле. null — без помилки. Непорожній рядок перевіряється тим самим правилом, що й реєстрація.',
  })
  @Matches(PHONE_REGEX, { message: INVALID_PHONE_MESSAGE })
  @IsString()
  @IsOptional()
  phone?: string | null;

  @ApiPropertyOptional({ example: 'SecurePassword123!' })
  @ValidateIf(isFieldPresent)
  @Matches(PASSWORD_STRENGTH_REGEX, { message: PASSWORD_STRENGTH_MESSAGE })
  @MaxLength(72, { message: 'Пароль занадто довгий.' })
  @MinLength(8, { message: 'Пароль має містити щонайменше 8 символів.' })
  @IsString()
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  password?: string;

  @ApiPropertyOptional({
    example: 'SecurePassword123!',
    description:
      'Передавайте разом із password. Без password порівняння неможливе.',
  })
  @ValidateIf(isFieldPresent)
  @Match('password', { message: PASSWORDS_DO_NOT_MATCH_MESSAGE })
  @IsString()
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  passwordConfirmation?: string;

  @ApiPropertyOptional({ example: true })
  @ValidateIf(isFieldPresent)
  @IsBoolean()
  @Equals(true, { message: TERMS_NOT_ACCEPTED_MESSAGE })
  termsAccepted?: boolean;
}

export class RegistrationFieldsValidationResponseDto {
  @ApiProperty({
    example: true,
    description: 'true, якщо всі передані поля пройшли перевірку.',
  })
  valid: boolean;
}

export class LoginResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  refreshToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: string;
}

export class RegisteredUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Іван' })
  firstName: string;

  @ApiProperty({ example: 'Петренко' })
  lastName: string;

  @ApiProperty({ example: 'owner@example.com' })
  email: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: '+380991234567',
  })
  phone: string | null;

  @ApiProperty({ enum: UserRole, example: UserRole.OWNER })
  role: UserRole;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status: UserStatus;

  @ApiProperty()
  organizationId: string;
}

export class RegisterResponseDto {
  @ApiProperty({ type: RegisteredUserDto })
  user: RegisteredUserDto;

  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  refreshToken: string;
}

export class RefreshTokenDto {
  @ApiProperty({
    example: 'rt_family.secret',
    description: 'Refresh token з відповіді login / register / Google.',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
