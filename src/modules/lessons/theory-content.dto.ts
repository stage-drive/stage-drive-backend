import { ApiProperty } from '@nestjs/swagger';
import { CourseMaterialType, LessonStatus } from '@prisma/client';

export class TheoryContentMaterialDto {
  @ApiProperty({ example: '71717171-7171-4717-8717-717171717171' })
  id: string;

  @ApiProperty({ example: 'Групи дорожніх знаків' })
  title: string;

  @ApiProperty({ enum: CourseMaterialType, example: CourseMaterialType.TEXT })
  type: CourseMaterialType;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Попереджувальні, пріоритету, заборонні.',
  })
  body: string | null;

  @ApiProperty({ example: 1, minimum: 1 })
  position: number;
}

/** Контент уроку курсу, прив’язаний до теоретичного заняття групи. */
export class TheoryLessonContentDto {
  @ApiProperty({ example: '51515151-5151-4515-8515-515151515151' })
  lessonId: string;

  @ApiProperty({ enum: LessonStatus, example: LessonStatus.SCHEDULED })
  lessonStatus: LessonStatus;

  @ApiProperty({ example: '41414141-4141-4414-8414-414141414141' })
  courseId: string;

  @ApiProperty({ example: '61616161-6161-4616-8616-616161616161' })
  courseLessonId: string;

  @ApiProperty({ example: '51515151-5151-4515-8515-515151515151' })
  chapterId: string;

  @ApiProperty({ example: 'Дорожні знаки' })
  title: string;

  @ApiProperty({ type: String, nullable: true, example: 'Огляд груп знаків.' })
  description: string | null;

  @ApiProperty({ example: 1, minimum: 1 })
  position: number;

  @ApiProperty({ type: [TheoryContentMaterialDto] })
  materials: TheoryContentMaterialDto[];
}
