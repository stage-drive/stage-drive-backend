import { ConflictException } from '@nestjs/common';
import {
  DrivingLessonStatus,
  EnrollmentStatus,
  LessonStatus,
  Prisma,
} from '@prisma/client';
import { LESSON_MAX_DURATION_MIN } from './lessons.dto';

export const LESSON_SCHEDULE_CONFLICT_MESSAGE =
  'Обраний час конфліктує з іншими заняттями.';

const MINUTE_MS = 60_000;

export type ConflictResource =
  'TEACHER' | 'INSTRUCTOR' | 'GROUP' | 'CAR' | 'STUDENT';

export type LessonType = 'THEORY' | 'PRACTICE';

export type ScheduleSlot = { start: Date; end: Date };

export type LessonConflict = {
  resource: ConflictResource;
  resourceId: string;
  lessonType: LessonType;
  lessonId: string;
  scheduledAt: Date;
  endsAt: Date;
};

type ScheduledRow = { id: string; scheduledAt: Date; durationMin: number };

const RESOURCE_ORDER: readonly ConflictResource[] = [
  'TEACHER',
  'INSTRUCTOR',
  'GROUP',
  'CAR',
  'STUDENT',
];

export function lessonEnd(scheduledAt: Date, durationMin: number): Date {
  return new Date(scheduledAt.getTime() + durationMin * MINUTE_MS);
}

export function lessonSlot(
  scheduledAt: Date,
  durationMin: number,
): ScheduleSlot {
  return { start: scheduledAt, end: lessonEnd(scheduledAt, durationMin) };
}

/** Напіввідкриті інтервали: 10:00–11:00 і 11:00–12:00 не перетинаються. */
export function overlaps(
  slot: ScheduleSlot,
  other: { scheduledAt: Date; durationMin: number },
): boolean {
  return (
    other.scheduledAt.getTime() < slot.end.getTime() &&
    lessonEnd(other.scheduledAt, other.durationMin).getTime() >
      slot.start.getTime()
  );
}

/**
 * Prisma не вміє фільтрувати за scheduledAt + durationMin, тому БД повертає
 * кандидатів, що починаються у вікні (start - MAX, end), а точний перетин
 * рахує overlaps(). Вікно точне завдяки CHECK на duration_min.
 */
export function candidateWindow(slot: ScheduleSlot): Prisma.DateTimeFilter {
  return {
    gt: new Date(slot.start.getTime() - LESSON_MAX_DURATION_MIN * MINUTE_MS),
    lt: slot.end,
  };
}

function toConflict(
  resource: ConflictResource,
  resourceId: string,
  lessonType: LessonType,
  row: ScheduledRow,
): LessonConflict {
  return {
    resource,
    resourceId,
    lessonType,
    lessonId: row.id,
    scheduledAt: row.scheduledAt,
    endsAt: lessonEnd(row.scheduledAt, row.durationMin),
  };
}

export function sortConflicts(conflicts: LessonConflict[]): LessonConflict[] {
  return [...conflicts].sort(
    (a, b) =>
      RESOURCE_ORDER.indexOf(a.resource) - RESOURCE_ORDER.indexOf(b.resource) ||
      a.scheduledAt.getTime() - b.scheduledAt.getTime() ||
      a.lessonId.localeCompare(b.lessonId),
  );
}

/** Нове заняття ще не має id, тож нічого не виключається. */
function excludeLesson(lessonId: string | null): { id?: { not: string } } {
  return lessonId === null ? {} : { id: { not: lessonId } };
}

export function scheduleConflict(
  conflicts: LessonConflict[],
): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message: LESSON_SCHEDULE_CONFLICT_MESSAGE,
    conflicts,
  });
}

/**
 * Теорія: інші заняття цієї групи й цього викладача, а також практика
 * студентів з ACTIVE-зарахуванням у групу.
 */
export async function findTheoryConflicts(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    /** Заняття, що змінюється; null для нового. */
    lessonId: string | null;
    groupId: string;
    teacherId: string;
    slot: ScheduleSlot;
  },
): Promise<LessonConflict[]> {
  const window = candidateWindow(input.slot);

  const theory = await tx.lesson.findMany({
    where: {
      ...excludeLesson(input.lessonId),
      status: LessonStatus.SCHEDULED,
      scheduledAt: window,
      group: { organizationId: input.organizationId },
      OR: [
        { groupId: input.groupId },
        { group: { teacherId: input.teacherId } },
      ],
    },
    select: {
      id: true,
      groupId: true,
      scheduledAt: true,
      durationMin: true,
      group: { select: { teacherId: true } },
    },
  });

  const practice = await tx.drivingLesson.findMany({
    where: {
      organizationId: input.organizationId,
      status: DrivingLessonStatus.SCHEDULED,
      scheduledAt: window,
      student: {
        enrollments: {
          some: { groupId: input.groupId, status: EnrollmentStatus.ACTIVE },
        },
      },
    },
    select: { id: true, studentId: true, scheduledAt: true, durationMin: true },
  });

  const conflicts: LessonConflict[] = [];
  for (const row of theory.filter((r) => overlaps(input.slot, r))) {
    if (row.groupId === input.groupId) {
      conflicts.push(toConflict('GROUP', input.groupId, 'THEORY', row));
    }
    if (row.group.teacherId === input.teacherId) {
      conflicts.push(toConflict('TEACHER', input.teacherId, 'THEORY', row));
    }
  }
  for (const row of practice.filter((r) => overlaps(input.slot, r))) {
    conflicts.push(toConflict('STUDENT', row.studentId, 'PRACTICE', row));
  }
  return sortConflicts(conflicts);
}

/**
 * Практика: інші заняття цього інструктора, авто чи студента, а також
 * теорія груп, де студент має ACTIVE-зарахування.
 */
export async function findPracticeConflicts(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    /** Заняття, що змінюється; null для нового. */
    lessonId: string | null;
    instructorId: string;
    carId: string;
    studentId: string;
    slot: ScheduleSlot;
  },
): Promise<LessonConflict[]> {
  const window = candidateWindow(input.slot);

  const practice = await tx.drivingLesson.findMany({
    where: {
      ...excludeLesson(input.lessonId),
      organizationId: input.organizationId,
      status: DrivingLessonStatus.SCHEDULED,
      scheduledAt: window,
      OR: [
        { instructorId: input.instructorId },
        { carId: input.carId },
        { studentId: input.studentId },
      ],
    },
    select: {
      id: true,
      instructorId: true,
      carId: true,
      studentId: true,
      scheduledAt: true,
      durationMin: true,
    },
  });

  const theory = await tx.lesson.findMany({
    where: {
      status: LessonStatus.SCHEDULED,
      scheduledAt: window,
      group: {
        organizationId: input.organizationId,
        enrollments: {
          some: { studentId: input.studentId, status: EnrollmentStatus.ACTIVE },
        },
      },
    },
    select: { id: true, scheduledAt: true, durationMin: true },
  });

  const conflicts: LessonConflict[] = [];
  for (const row of practice.filter((r) => overlaps(input.slot, r))) {
    if (row.instructorId === input.instructorId) {
      conflicts.push(
        toConflict('INSTRUCTOR', input.instructorId, 'PRACTICE', row),
      );
    }
    if (row.carId === input.carId) {
      conflicts.push(toConflict('CAR', input.carId, 'PRACTICE', row));
    }
    if (row.studentId === input.studentId) {
      conflicts.push(toConflict('STUDENT', input.studentId, 'PRACTICE', row));
    }
  }
  for (const row of theory.filter((r) => overlaps(input.slot, r))) {
    conflicts.push(toConflict('STUDENT', input.studentId, 'THEORY', row));
  }
  return sortConflicts(conflicts);
}
