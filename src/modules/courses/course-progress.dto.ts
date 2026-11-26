import { ApiProperty } from '@nestjs/swagger';
import {
  AttendanceStatus,
  LessonStatus,
  TheoryTestPublicationStatus,
  TheoryTestStatus,
} from '@prisma/client';

/** Очне заняття групи, прив’язане до уроку курсу, і відмітка цього студента. */
export class LinkedTheorySessionDto {
  @ApiProperty({ example: '51515151-5151-4515-8515-515151515151' })
  lessonId: string;

  @ApiProperty({ example: 'Дорожні знаки' })
  topic: string;

  @ApiProperty({ type: String, format: 'date-time' })
  scheduledAt: Date;

  @ApiProperty({ example: 90 })
  durationMin: number;

  @ApiProperty({ enum: LessonStatus, example: LessonStatus.SCHEDULED })
  status: LessonStatus;

  @ApiProperty({
    enum: AttendanceStatus,
    nullable: true,
    example: AttendanceStatus.PRESENT,
    description:
      'Відмітка цього студента. null — ще не відмічено. Скасоване заняття теж повертається, щоб статус відмітки не розходився зі статусом заняття.',
  })
  attendance: AttendanceStatus | null;
}

/** Стан опублікованого тесту уроку для цього студента в поточному циклі спроб. */
export class LessonTestProgressDto {
  @ApiProperty({
    example: '91919191-9191-4919-8919-919191919191',
    description:
      'Id тесту. Далі: GET /lessons/{lessonId}/test і POST /tests/{id}/attempts.',
  })
  id: string;

  @ApiProperty({
    enum: TheoryTestPublicationStatus,
    example: TheoryTestPublicationStatus.PUBLISHED,
    description:
      'Студент бачить лише опублікований тест, тож тут завжди PUBLISHED.',
  })
  status: TheoryTestPublicationStatus;

  @ApiProperty({
    example: false,
    description:
      'Тест складено (PASSED). Лише це відкриває наступний урок; перегляд матеріалів не обов’язковий.',
  })
  passed: boolean;

  @ApiProperty({
    example: 1,
    description:
      'Скільки спроб поточного циклу вже зайнято: витрачені та відкрита (IN_PROGRESS).',
  })
  attemptsUsed: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 2,
    description:
      'Скільки спроб ще можна почати в поточному циклі. 0 — вичерпано, «Пройдіть урок ще раз.».',
  })
  attemptsLeft: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 3,
    description: 'Скільки спроб дає цикл. У тесту уроку їх 3.',
  })
  maxAttempts: number | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Відкрита спроба, яку можна продовжити (GET /tests/attempts/{id}).',
  })
  openAttemptId: string | null;

  @ApiProperty({
    example: true,
    description: 'Чи можна зараз почати нову спробу.',
  })
  nextAttemptAvailable: boolean;

  @ApiProperty({
    example: true,
    description:
      'Наступний урок закритий, доки тест не складено (passed = false).',
  })
  lockedNextUntilPassed: boolean;
}

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
    description:
      'true, якщо урок завершено: тест уроку складено (PASSED), а коли опублікованого тесту немає — урок позначено пройденим. ' +
      'Лише позначка «пройдено» при наявному тесті урок не завершує.',
  })
  completed: boolean;

  @ApiProperty({
    example: false,
    description:
      'true, коли попередній опублікований урок ще не завершено: тест не складено або, без тесту, урок не позначено пройденим. Контент такого уроку не віддається.',
  })
  locked: boolean;

  @ApiProperty({
    example: false,
    description:
      'true, якщо опублікований тест цього уроку складено. false, якщо тесту немає або він ще не складений.',
  })
  passed: boolean;

  @ApiProperty({
    example: false,
    description: 'true, якщо в уроку є опублікований тест.',
  })
  hasTest: boolean;

  @ApiProperty({
    type: LessonTestProgressDto,
    nullable: true,
    description:
      'Тест уроку і стан спроб поточного циклу. null, якщо в уроку немає опублікованого тесту.',
  })
  test: LessonTestProgressDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Пройдіть урок ще раз.',
    description:
      'Є, коли всі спроби тесту уроку витрачено без PASSED. Нові 3 спроби відкриваються після повторного проходження уроку ' +
      '(POST /courses/{courseId}/lessons/{lessonId}/complete). null — повторювати урок не потрібно.',
  })
  retryMessage: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Коли урок завершено вперше: час першого PASSED тесту уроку або, без тесту, час позначки «пройдено». null, якщо ще не завершено.',
  })
  completedAt: Date | null;

  @ApiProperty({
    type: [LinkedTheorySessionDto],
    description:
      'Очні заняття груп цього студента, прив’язані до уроку. Для власного прогресу — лише активне зарахування.',
  })
  sessions: LinkedTheorySessionDto[];
}

export class TheoryTestResultDto {
  @ApiProperty({ example: '91919191-9191-4919-8919-919191919191' })
  id: string;

  @ApiProperty({ example: '41414141-4141-4414-8414-414141414141' })
  courseId: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: '61616161-6161-4616-8616-616161616161',
    description:
      'Тест, з якого пораховано цей результат. null — старий запис без спроби.',
  })
  testId: string | null;

  @ApiProperty({ example: '13131313-1313-4131-8131-131313131313' })
  studentId: string;

  @ApiProperty({ enum: TheoryTestStatus, example: TheoryTestStatus.PASSED })
  status: TheoryTestStatus;

  @ApiProperty({ nullable: true, type: Number, example: 86 })
  score: number | null;

  @ApiProperty({ type: String, format: 'date-time' })
  takenAt: Date;
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

  @ApiProperty({
    type: TheoryTestResultDto,
    nullable: true,
    deprecated: true,
    description:
      'Застарілий результат тесту всього курсу: старий тест без уроку або запис, зроблений вручну. ' +
      'Результати тестів уроків дивіться в lessons[].test, а їхні спроби — у GET /tests/{testId}/attempts/me. ' +
      'null, якщо такого результату немає.',
  })
  test: TheoryTestResultDto | null;
}
