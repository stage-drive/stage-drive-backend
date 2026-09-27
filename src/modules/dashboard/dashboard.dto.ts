import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrganizationStatus, UserRole, UserStatus } from '@prisma/client';

export class DashboardOrganizationDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Stage Drive School' })
  name: string;

  @ApiProperty({ enum: OrganizationStatus, example: OrganizationStatus.ACTIVE })
  status: OrganizationStatus;

  @ApiPropertyOptional({ nullable: true, type: String })
  logoUrl: string | null;

  @ApiProperty({ example: 'Europe/Kyiv' })
  timezone: string;
}

export class DashboardUsersByRoleDto {
  @ApiProperty({ example: 1 })
  OWNER: number;

  @ApiProperty({ example: 1 })
  ADMIN: number;

  @ApiProperty({ example: 0 })
  TEACHER: number;

  @ApiProperty({ example: 0 })
  INSTRUCTOR: number;

  @ApiProperty({ example: 0 })
  STUDENT: number;
}

export class DashboardUsersByStatusDto {
  @ApiProperty({ example: 0 })
  INVITED: number;

  @ApiProperty({ example: 2 })
  ACTIVE: number;

  @ApiProperty({ example: 0 })
  BLOCKED: number;

  @ApiProperty({ example: 0 })
  ARCHIVED: number;
}

export class DashboardUsersDto {
  @ApiProperty({
    description: 'Користувачі автошколи без soft-delete, включно з OWNER.',
    example: 2,
  })
  total: number;

  @ApiProperty({ type: DashboardUsersByRoleDto })
  byRole: Record<UserRole, number>;

  @ApiProperty({ type: DashboardUsersByStatusDto })
  byStatus: Record<UserStatus, number>;
}

export class DashboardInvitationsDto {
  @ApiProperty({
    description: 'PENDING запрошення, термін яких ще не минув.',
    example: 0,
  })
  pending: number;

  @ApiProperty({
    description: 'PENDING запрошення з expiresAt у минулому.',
    example: 0,
  })
  expired: number;
}

export class OwnerDashboardDto {
  @ApiProperty({ type: DashboardOrganizationDto })
  organization: DashboardOrganizationDto;

  @ApiProperty({ type: DashboardUsersDto })
  users: DashboardUsersDto;

  @ApiProperty({ type: DashboardInvitationsDto })
  invitations: DashboardInvitationsDto;
}

export class AdminDashboardOrganizationDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Stage Drive School' })
  name: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  logoUrl: string | null;

  @ApiProperty({ example: 'Europe/Kyiv' })
  timezone: string;
}

export class AdminDashboardUsersByRoleDto {
  @ApiProperty({ example: 1 })
  TEACHER: number;

  @ApiProperty({ example: 2 })
  INSTRUCTOR: number;

  @ApiProperty({ example: 10 })
  STUDENT: number;
}

export class AdminDashboardUsersDto {
  @ApiProperty({
    description:
      'Користувачі автошколи з ролями TEACHER, INSTRUCTOR і STUDENT, без soft-delete. OWNER і ADMIN сюди не входять.',
    example: 13,
  })
  total: number;

  @ApiProperty({ type: AdminDashboardUsersByRoleDto })
  byRole: AdminDashboardUsersByRoleDto;

  @ApiProperty({ type: DashboardUsersByStatusDto })
  byStatus: DashboardUsersByStatusDto;
}

export class AdminDashboardInvitationsDto {
  @ApiProperty({
    description:
      'PENDING запрошення TEACHER, INSTRUCTOR або STUDENT, термін яких ще не минув.',
    example: 0,
  })
  pending: number;

  @ApiProperty({
    description:
      'PENDING запрошення TEACHER, INSTRUCTOR або STUDENT з expiresAt у минулому.',
    example: 0,
  })
  expired: number;
}

export class AdminDashboardDto {
  @ApiProperty({ type: AdminDashboardOrganizationDto })
  organization: AdminDashboardOrganizationDto;

  @ApiProperty({ type: AdminDashboardUsersDto })
  users: AdminDashboardUsersDto;

  @ApiProperty({ type: AdminDashboardInvitationsDto })
  invitations: AdminDashboardInvitationsDto;
}
