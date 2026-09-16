import {
  ApiProperty,
  ApiPropertyOptional,
  IntersectionType,
} from '@nestjs/swagger';
import { InvitationStatus, UserRole, UserStatus } from '@prisma/client';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const PHONE_REGEX = /^\+?[0-9\s-]{7,20}$/;

const REQUIRED_FIELD_MESSAGE = "Заповніть обов'язкове поле.";
const INVALID_EMAIL_MESSAGE = 'Введіть коректний email.';

export const ADMIN_INVITABLE_ROLES: UserRole[] = [
  UserRole.TEACHER,
  UserRole.INSTRUCTOR,
  UserRole.STUDENT,
];

export const INVALID_INVITE_ROLE_MESSAGE =
  'Можна запрошувати лише TEACHER, INSTRUCTOR або STUDENT.';

export class InviteAdminDto {
  @ApiProperty({ example: 'Олена' })
  @MaxLength(60)
  @IsString()
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  firstName: string;

  @ApiProperty({ example: 'Коваль' })
  @MaxLength(60)
  @IsString()
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  lastName: string;

  @ApiProperty({ example: 'admin@example.com' })
  @IsEmail({}, { message: INVALID_EMAIL_MESSAGE })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  email: string;

  @ApiProperty({ example: '+380991234567', required: false, nullable: true })
  @Matches(PHONE_REGEX, { message: 'Введіть коректний номер телефону.' })
  @IsString()
  @IsOptional()
  phone?: string;
}

class InviteMemberRoleDto {
  @ApiProperty({
    enum: ADMIN_INVITABLE_ROLES,
    example: UserRole.TEACHER,
  })
  @IsIn(ADMIN_INVITABLE_ROLES, { message: INVALID_INVITE_ROLE_MESSAGE })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  role: UserRole;
}

export class InviteMemberDto extends IntersectionType(
  InviteAdminDto,
  InviteMemberRoleDto,
) {}

export class InvitedUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Олена' })
  firstName: string;

  @ApiProperty({ example: 'Коваль' })
  lastName: string;

  @ApiProperty({ example: 'teacher@example.com' })
  email: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  phone: string | null;

  @ApiProperty({ enum: UserRole, example: UserRole.TEACHER })
  role: UserRole;

  @ApiProperty({ enum: UserStatus, example: UserStatus.INVITED })
  status: UserStatus;

  @ApiProperty()
  organizationId: string;
}

export class CreatedInvitationDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'teacher@example.com' })
  email: string;

  @ApiProperty({ enum: UserRole, example: UserRole.TEACHER })
  role: UserRole;

  @ApiProperty({ enum: InvitationStatus, example: InvitationStatus.PENDING })
  status: InvitationStatus;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  organizationId: string;
}

export class InviteResponseDto {
  @ApiProperty({ type: InvitedUserDto })
  user: InvitedUserDto;

  @ApiProperty({ type: CreatedInvitationDto })
  invitation: CreatedInvitationDto;
}
