import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
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
} from 'class-validator';
import { Match } from '../../common/validators/match.decorator';

const PHONE_REGEX = /^\+?[0-9\s-]{7,20}$/;

const REQUIRED_FIELD_MESSAGE = "Заповніть обов'язкове поле.";
const INVALID_EMAIL_MESSAGE = 'Введіть коректний email.';
const PASSWORDS_DO_NOT_MATCH_MESSAGE = 'Паролі не співпадають.';

// class-validator (legacy TS decorators) registers stacked property decorators
// bottom-to-top, so the bottom-most decorator is evaluated FIRST. With
// `stopAtFirstError: true` on the global pipe, the "required" check must sit
// closest to the property so it wins over format-specific checks on empty input.

export class LoginDto {
  @ApiProperty({ example: 'owner@example.com' })
  @IsEmail({}, { message: INVALID_EMAIL_MESSAGE })
  email: string;

  @ApiProperty({ example: 'Password1' })
  @IsString()
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  password: string;
}

export class RegisterDto {
  @ApiProperty({ example: 'Автошкола Drive' })
  @MaxLength(120)
  @IsString()
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  organizationName: string;

  @ApiProperty({ example: 'Іван' })
  @MaxLength(60)
  @IsString()
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  firstName: string;

  @ApiProperty({ example: 'Петренко' })
  @MaxLength(60)
  @IsString()
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  lastName: string;

  @ApiProperty({ example: 'owner@example.com' })
  @IsEmail({}, { message: INVALID_EMAIL_MESSAGE })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  email: string;

  @ApiProperty({ example: '+380991234567', required: false, nullable: true })
  @Matches(PHONE_REGEX, { message: 'Введіть коректний номер телефону.' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({ example: 'SecurePassword123!' })
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
  @Equals(true, { message: 'Потрібно погодитися з умовами використання.' })
  termsAccepted: boolean;
}

export class LoginResponseDto {
  @ApiProperty()
  accessToken: string;

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

  @ApiProperty({ enum: UserRole, example: UserRole.OWNER })
  role: UserRole;

  @ApiProperty({ example: 'ACTIVE' })
  status: string;

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
