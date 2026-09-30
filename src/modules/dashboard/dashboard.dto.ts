import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GroupStatus, OrganizationStatus, UserRole, UserStatus } from '@prisma/client';

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


export class TeacherDashboardGroupDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'ПДР — Група А' })
  name: string;

  @ApiProperty({ enum: GroupStatus, example: GroupStatus.ACTIVE })
  status: GroupStatus;

  @ApiProperty({ example: 12 })
  studentsCount: number;
}

export class TeacherDashboardLessonDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  groupId: string;

  @ApiProperty({ example: 'ПДР — Група А' })
  groupName: string;

  @ApiProperty({ example: 'Розділ 3: Дорожні знаки' })
  topic: string;

  @ApiProperty()
  scheduledAt: Date;
}

export class TeacherDashboardStatsDto {
  @ApiProperty({ example: 3 })
  groupsTotal: number;

  @ApiProperty({
    description: 'Унікальні студенти в усіх групах цього TEACHER (без дублів, якщо студент у двох групах).',
    example: 34,
  })
  studentsTotal: number;

  @ApiProperty({ example: 5 })
  upcomingLessonsTotal: number;
}

export class TeacherDashboardProfileDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Ганна' })
  firstName: string;

  @ApiProperty({ example: 'Коваль' })
  lastName: string;

  @ApiProperty({ example: 'teacher@example.com' })
  email: string;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status: UserStatus;
}

export class TeacherDashboardDto {
  @ApiProperty({ type: AdminDashboardOrganizationDto })
  organization: AdminDashboardOrganizationDto;

  @ApiProperty({ type: TeacherDashboardProfileDto })
  teacher: TeacherDashboardProfileDto;

  @ApiProperty({ type: TeacherDashboardStatsDto })
  stats: TeacherDashboardStatsDto;

  @ApiProperty({ type: [TeacherDashboardGroupDto] })
  groups: TeacherDashboardGroupDto[];

  @ApiProperty({
    type: [TeacherDashboardLessonDto],
    description: 'Наступні 5 запланованих занять цього TEACHER, за зростанням дати.',
  })
  upcomingLessons: TeacherDashboardLessonDto[];
}


export class StudentDashboardProfileDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Олена' })
  firstName: string;

  @ApiProperty({ example: 'Петренко' })
  lastName: string;

  @ApiProperty({ example: 'student@example.com' })
  email: string;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status: UserStatus;
}

export class StudentDashboardGroupDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'ПДР — Група А' })
  name: string;

  @ApiProperty({ enum: GroupStatus, example: GroupStatus.ACTIVE })
  status: GroupStatus;

  @ApiProperty({ example: 'Ганна Коваль' })
  teacherName: string;
}

export class StudentDashboardLessonDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  groupId: string;

  @ApiProperty({ example: 'ПДР — Група А' })
  groupName: string;

  @ApiProperty({ example: 'Розділ 3: Дорожні знаки' })
  topic: string;

  @ApiProperty()
  scheduledAt: Date;
}

export class StudentDashboardStatsDto {
  @ApiProperty({ example: 2 })
  groupsTotal: number;

  @ApiProperty({ example: 3 })
  upcomingLessonsTotal: number;
}

export class StudentDashboardDto {
  @ApiProperty({ type: AdminDashboardOrganizationDto })
  organization: AdminDashboardOrganizationDto;

  @ApiProperty({ type: StudentDashboardProfileDto })
  student: StudentDashboardProfileDto;

  @ApiProperty({ type: StudentDashboardStatsDto })
  stats: StudentDashboardStatsDto;

  @ApiProperty({ type: [StudentDashboardGroupDto] })
  groups: StudentDashboardGroupDto[];

  @ApiProperty({
    type: [StudentDashboardLessonDto],
    description: 'Наступні 5 запланованих занять студента, за зростанням дати.',
  })
  upcomingLessons: StudentDashboardLessonDto[];
}

export class InstructorDashboardProfileDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Максим' })
  firstName: string;

  @ApiProperty({ example: 'Гриценко' })
  lastName: string;

  @ApiProperty({ example: 'instructor@example.com' })
  email: string;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status: UserStatus;
}

export class InstructorDashboardLessonDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  studentId: string;

  @ApiProperty({ example: 'Олена Петренко' })
  studentName: string;

  @ApiProperty()
  scheduledAt: Date;
}

export class InstructorDashboardStatsDto {
  @ApiProperty({
    description: 'Унікальні студенти з майбутніми заняттями цього INSTRUCTOR.',
    example: 8,
  })
  studentsTotal: number;

  @ApiProperty({ example: 5 })
  upcomingLessonsTotal: number;
}

export class InstructorDashboardDto {
  @ApiProperty({ type: AdminDashboardOrganizationDto })
  organization: AdminDashboardOrganizationDto;

  @ApiProperty({ type: InstructorDashboardProfileDto })
  instructor: InstructorDashboardProfileDto;

  @ApiProperty({ type: InstructorDashboardStatsDto })
  stats: InstructorDashboardStatsDto;

  @ApiProperty({
    type: [InstructorDashboardLessonDto],
    description: 'Наступні 5 запланованих практичних занять, за зростанням дати.',
  })
  upcomingLessons: InstructorDashboardLessonDto[];
}