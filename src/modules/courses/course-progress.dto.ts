import { ApiProperty } from '@nestjs/swagger';

export class CourseLessonProgressDto {
  @ApiProperty({ example: '61616161-6161-4616-8616-616161616161' })
  lessonId: string;

  @ApiProperty({ example: '51515151-5151-4515-8515-515151515151' })
  chapterId: string;

  @ApiProperty({ example: 'Дорожні знаки' })
  title: string;

  @ApiProperty({
    example: 1,
    minimum: 1,
    description: 'Позиція уроку в розділі.',
  })
  position: number;

  @ApiProperty({
    example: 1,
    minimum: 1,
    description: 'Позиція розділу в курсі.',
  })
  chapterPosition: number;

  @ApiProperty({
    example: true,
    description: 'true, якщо студент уже пройшов цей урок.',
  })
  completed: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Коли урок пройдено вперше. null, якщо ще не пройдено.',
  })
  completedAt: Date | null;
}

export class CourseProgressDto {
  @ApiProperty({ example: '41414141-4141-4414-8414-414141414141' })
  courseId: string;

  @ApiProperty({
    example: '13131313-1313-4131-8131-131313131313',
    description:
      'Id користувача-студента. Для власного прогресу це id з access token.',
  })
  studentId: string;

  @ApiProperty({
    example: 1,
    minimum: 0,
    description: 'Скільки уроків цього курсу студент уже пройшов.',
  })
  completedLessonCount: number;

  @ApiProperty({
    example: 3,
    minimum: 0,
    description: 'Скільки уроків зараз є в курсі.',
  })
  totalLessonCount: number;

  @ApiProperty({
    example: 33,
    minimum: 0,
    maximum: 100,
    description:
      'Цілий відсоток від 0 до 100: round(completedLessonCount / totalLessonCount * 100). 0, якщо уроків ще немає.',
  })
  percent: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Коли збережений прогрес востаннє змінився. null, якщо студент ще не проходив жоден урок і знімок не створювався.',
  })
  updatedAt: Date | null;

  @ApiProperty({
    type: [CourseLessonProgressDto],
    description:
      'Усі уроки курсу за порядком розділів і уроків. Повторне проходження не додає другий запис.',
  })
  lessons: CourseLessonProgressDto[];
}
