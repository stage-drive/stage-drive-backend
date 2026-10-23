import { Prisma } from '@prisma/client';
import {
  LessonPersonDto,
  PracticeLessonDto,
  TheoryLessonDto,
} from './lessons.dto';
import { lessonEnd } from './schedule-conflicts';

/**
 * Форма заняття у відповідях API: select-и з полями, що потрапляють у DTO, і
 * мапери рядка в DTO. Select-и запису в LessonsService — надмножини цих, тож
 * їхні рядки передаються в мапери без перетворень.
 */

export const lessonPersonSelect = {
  id: true,
  firstName: true,
  lastName: true,
} satisfies Prisma.UserSelect;

export const theoryLessonViewSelect = {
  id: true,
  topic: true,
  scheduledAt: true,
  durationMin: true,
  status: true,
  cancelledAt: true,
  cancellationReason: true,
  updatedAt: true,
  group: {
    select: { id: true, name: true, teacher: { select: lessonPersonSelect } },
  },
} satisfies Prisma.LessonSelect;

export type TheoryLessonView = Prisma.LessonGetPayload<{
  select: typeof theoryLessonViewSelect;
}>;

export const practiceLessonViewSelect = {
  id: true,
  scheduledAt: true,
  durationMin: true,
  status: true,
  cancelledAt: true,
  cancellationReason: true,
  updatedAt: true,
  instructor: { select: lessonPersonSelect },
  student: { select: lessonPersonSelect },
  car: {
    select: { id: true, plateNumber: true, category: true, transmission: true },
  },
} satisfies Prisma.DrivingLessonSelect;

export type PracticeLessonView = Prisma.DrivingLessonGetPayload<{
  select: typeof practiceLessonViewSelect;
}>;

/** Лише id та ім'я: рядок може містити статус, роль чи профіль людини. */
function toPerson(user: LessonPersonDto): LessonPersonDto {
  return { id: user.id, firstName: user.firstName, lastName: user.lastName };
}

export function toTheoryLessonDto(row: TheoryLessonView): TheoryLessonDto {
  return {
    id: row.id,
    type: 'THEORY',
    status: row.status,
    topic: row.topic,
    scheduledAt: row.scheduledAt,
    endsAt: lessonEnd(row.scheduledAt, row.durationMin),
    durationMin: row.durationMin,
    group: { id: row.group.id, name: row.group.name },
    teacher: toPerson(row.group.teacher),
    cancelledAt: row.cancelledAt,
    cancellationReason: row.cancellationReason,
    updatedAt: row.updatedAt,
  };
}

export function toPracticeLessonDto(
  row: PracticeLessonView,
): PracticeLessonDto {
  return {
    id: row.id,
    type: 'PRACTICE',
    status: row.status,
    scheduledAt: row.scheduledAt,
    endsAt: lessonEnd(row.scheduledAt, row.durationMin),
    durationMin: row.durationMin,
    instructor: toPerson(row.instructor),
    student: toPerson(row.student),
    car: row.car
      ? {
          id: row.car.id,
          plateNumber: row.car.plateNumber,
          category: row.car.category,
          transmission: row.car.transmission,
        }
      : null,
    cancelledAt: row.cancelledAt,
    cancellationReason: row.cancellationReason,
    updatedAt: row.updatedAt,
  };
}
