import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

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
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Петренко' })
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
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword: string;
}

export class MessageResponseDto {
  @ApiProperty({ example: 'Password updated' })
  message: string;
}
