import { ApiProperty } from '@nestjs/swagger';
import { GroupStatus } from '@prisma/client';

export class GroupTeacherDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Ірина' })
  firstName: string;

  @ApiProperty({ example: 'Мельник' })
  lastName: string;
}

export class GroupListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'ПДР — Група А' })
  name: string;

  @ApiProperty({ enum: GroupStatus, example: GroupStatus.ACTIVE })
  status: GroupStatus;

  @ApiProperty({ type: Date, nullable: true })
  startDate: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  endDate: Date | null;

  @ApiProperty({ type: GroupTeacherDto })
  teacher: GroupTeacherDto;

  @ApiProperty({
    description:
      'Кількість студентів з активним зарахуванням (Enrollment.status = ACTIVE).',
    example: 12,
  })
  studentsCount: number;

  @ApiProperty()
  createdAt: Date;
}

export class GroupListDto {
  @ApiProperty({ type: [GroupListItemDto] })
  groups: GroupListItemDto[];
}
