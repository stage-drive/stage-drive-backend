import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

export class PublicUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  phone: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  avatarUrl: string | null;

  @ApiProperty({ enum: UserRole })
  role: UserRole;

  @ApiProperty()
  organizationId: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional()
  firstName?: string;

  @ApiPropertyOptional()
  lastName?: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  phone?: string | null;
}

export class ChangePasswordDto {
  @ApiProperty()
  currentPassword: string;

  @ApiProperty({ minLength: 8 })
  newPassword: string;
}

export class MessageResponseDto {
  @ApiProperty()
  message: string;
}
