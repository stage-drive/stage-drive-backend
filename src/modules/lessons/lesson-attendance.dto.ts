import { ApiProperty } from '@nestjs/swagger';
import { AttendanceStatus, EnrollmentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsEnum,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import {
  LessonPersonDto,
  REQUIRED_FIELD_MESSAGE,
  TheoryLessonDto,
} from './lessons.dto';

/** Із запасом більше за будь-яку групу; захищає від надто великого пакета. */
export const ATTENDANCE_MAX_RECORDS = 100;

export const ATTENDANCE_STATUS_VALUE_MESSAGE =
  'status має бути PRESENT, ABSENT, LATE або EXCUSED.';
export const ATTENDANCE_RECORDS_MESSAGE = `records має бути масивом від 1 до ${ATTENDANCE_MAX_RECORDS} елементів.`;
export const ATTENDANCE_DUPLICATE_STUDENT_MESSAGE =
  'Кожен студент може бути в records лише один раз.';

export class AttendanceRecordDto {
  @ApiProperty({
    format: 'uuid',
    example: '88888888-8888-4888-8888-888888888888',
    description:
      'Id користувача-студента з активним зарахуванням у групу заняття.',
  })
  @IsUUID('4', { message: 'studentId має бути UUID.' })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  studentId: string;

  @ApiProperty({ enum: AttendanceStatus, example: AttendanceStatus.PRESENT })
  @IsEnum(AttendanceStatus, { message: ATTENDANCE_STATUS_VALUE_MESSAGE })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  status: AttendanceStatus;
}

export class UpdateLessonAttendanceDto {
  @ApiProperty({
    type: [AttendanceRecordDto],
    minItems: 1,
    maxItems: ATTENDANCE_MAX_RECORDS,
    description:
      'Змінюються лише перелічені студенти; решта лишається як була. Студент не повторюється.',
  })
  // stopAtFirstError: перевірки йдуть знизу вгору, а вкладені — лише коли
  // масив сам по собі коректний. Не-об'єкт без studentId порівнюється сам із собою.
  @ValidateNested({ each: true })
  @Type(() => AttendanceRecordDto)
  @ArrayUnique(
    (record: Partial<AttendanceRecordDto>) => record.studentId ?? record,
    { message: ATTENDANCE_DUPLICATE_STUDENT_MESSAGE },
  )
  @ArrayMaxSize(ATTENDANCE_MAX_RECORDS, { message: ATTENDANCE_RECORDS_MESSAGE })
  @ArrayNotEmpty({ message: ATTENDANCE_RECORDS_MESSAGE })
  @IsArray({ message: ATTENDANCE_RECORDS_MESSAGE })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  records: AttendanceRecordDto[];
}

export class AttendanceMarkDto {
  @ApiProperty({ enum: AttendanceStatus, example: AttendanceStatus.PRESENT })
  status: AttendanceStatus;

  @ApiProperty({
    example: '2026-11-03T16:05:12.000Z',
    description: 'Коли статус востаннє змінено.',
  })
  markedAt: Date;

  @ApiProperty({
    type: LessonPersonDto,
    nullable: true,
    description: 'Хто востаннє змінив статус; null, якщо автора видалено.',
  })
  markedBy: LessonPersonDto | null;
}

export class LessonAttendanceStudentDto {
  @ApiProperty({ description: 'Id користувача-студента.' })
  id: string;

  @ApiProperty({ example: 'Олена' })
  firstName: string;

  @ApiProperty({ example: 'Коваль' })
  lastName: string;

  @ApiProperty({
    enum: EnrollmentStatus,
    nullable: true,
    example: EnrollmentStatus.ACTIVE,
    description:
      'Зарахування в групу заняття. null — студента видалили з групи, але відмітка лишилась. ' +
      'Змінювати можна лише ACTIVE.',
  })
  enrollmentStatus: EnrollmentStatus | null;

  @ApiProperty({
    type: AttendanceMarkDto,
    nullable: true,
    description: 'null — ще не відмічено.',
  })
  attendance: AttendanceMarkDto | null;
}

export class LessonAttendanceDto {
  @ApiProperty({ type: TheoryLessonDto })
  lesson: TheoryLessonDto;

  @ApiProperty({
    description:
      'Чи можна зараз змінювати відвідування: заняття не скасоване, вже почалося, група відкрита. ' +
      'Рядок студента можна змінити, коли editable і enrollmentStatus = ACTIVE.',
  })
  editable: boolean;

  @ApiProperty({
    type: [LessonAttendanceStudentDto],
    description: 'Відсортовано за прізвищем, ім’ям, id.',
  })
  students: LessonAttendanceStudentDto[];
}
