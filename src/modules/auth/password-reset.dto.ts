import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Match } from '../../common/validators/match.decorator';

const REQUIRED_FIELD_MESSAGE = "Заповніть обов'язкове поле.";
const INVALID_EMAIL_MESSAGE = 'Введіть коректний email.';
const PASSWORDS_DO_NOT_MATCH_MESSAGE = 'Паролі не співпадають.';

export class RequestPasswordResetDto {
  @ApiProperty({ example: 'owner@example.com' })
  @IsEmail({}, { message: INVALID_EMAIL_MESSAGE })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  token: string;

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
}
