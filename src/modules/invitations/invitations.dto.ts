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
  MinLength,
} from 'class-validator';
import { Match } from '../../common/validators/match.decorator';

const PHONE_REGEX = /^\+?[0-9\s-]{7,20}$/;

const REQUIRED_FIELD_MESSAGE = "Заповніть обов'язкове поле.";
const INVALID_EMAIL_MESSAGE = 'Введіть коректний email.';
const PASSWORDS_DO_NOT_MATCH_MESSAGE = 'Паролі не співпадають.';

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

export class VerifyInvitationDto {
  @ApiProperty({
    description: 'Сирий invitation token з листа (query `token`).',
    example: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
  })
  @IsString()
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  token: string;
}

export class VerifyInvitationResponseDto {
  @ApiProperty({ example: true })
  valid: true;

  @ApiProperty({ example: 'admin@example.com' })
  email: string;

  @ApiProperty({ example: 'Олена' })
  firstName: string;

  @ApiProperty({ example: 'Коваль' })
  lastName: string;

  @ApiProperty({ enum: UserRole, example: UserRole.ADMIN })
  role: UserRole;

  @ApiProperty({ enum: InvitationStatus, example: InvitationStatus.PENDING })
  status: InvitationStatus;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty({ example: 'Автошкола Drive' })
  organizationName: string;

  @ApiProperty()
  organizationId: string;
}

export const InvitationTokenErrorCode = {
  INVALID: 'INVALID_INVITATION_TOKEN',
  EXPIRED: 'EXPIRED_INVITATION_TOKEN',
  CANCELLED: 'CANCELLED_INVITATION_TOKEN',
  USED: 'USED_INVITATION_TOKEN',
} as const;

export type InvitationTokenErrorCode =
  (typeof InvitationTokenErrorCode)[keyof typeof InvitationTokenErrorCode];

export class ActivateInvitationDto {
  @ApiProperty({
    description: 'Сирий invitation token з листа (query `token`).',
    example: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
  })
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

export class ActivatedInvitationDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'admin@example.com' })
  email: string;

  @ApiProperty({ enum: UserRole, example: UserRole.ADMIN })
  role: UserRole;

  @ApiProperty({ enum: InvitationStatus, example: InvitationStatus.ACCEPTED })
  status: InvitationStatus;

  @ApiProperty()
  acceptedAt: Date;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  organizationId: string;
}

export class ActivateInvitationResponseDto {
  @ApiProperty({ type: InvitedUserDto })
  user: InvitedUserDto;

  @ApiProperty({ type: ActivatedInvitationDto })
  invitation: ActivatedInvitationDto;
}

export class InvitationTokenErrorDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({
    enum: Object.values(InvitationTokenErrorCode),
    example: InvitationTokenErrorCode.INVALID,
  })
  code: InvitationTokenErrorCode;

  @ApiProperty({ example: 'Посилання-запрошення недійсне.' })
  message: string;
}
