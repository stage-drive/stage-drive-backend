import { ApiProperty } from '@nestjs/swagger';
import { CourseStatus } from '@prisma/client';

export class CourseListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Теоретичний курс, категорія B' })
  name: string;

  @ApiProperty({
    enum: CourseStatus,
    example: CourseStatus.ACTIVE,
    description: 'Групі можна призначити лише ACTIVE-курс.',
  })
  status: CourseStatus;
}

export class CourseListDto {
  @ApiProperty({ type: [CourseListItemDto] })
  courses: CourseListItemDto[];
}
