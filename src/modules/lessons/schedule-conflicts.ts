import { ConflictException } from '@nestjs/common';
import { EnrollmentStatus, LessonStatus, Prisma } from '@prisma/client';
import { LESSON_MAX_DURATION_MIN } from './lessons.dto';

export const LESSON_SCHEDULE_CONFLICT_MESSAGE =
  'Обраний час конфліктує з іншими заняттями.';

const MINUTE_MS = 60_000;

export type ConflictResource =
  'TEACHER' | 'INSTRUCTOR' | 'GROUP' | 'CAR' | 'STUDENT';

/**
 * SLOT — слот практики; у конфлікті з ним lessonId містить id слоту.
 * TIME_OFF — недоступність інструктора; lessonId містить її id, scheduledAt і
 * endsAt — її межі.
 */
export type LessonType = 'THEORY' | 'PRACTICE' | 'SLOT' | 'TIME_OFF';

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
      organizationId: input.organizationId,
      status: LessonStatus.SCHEDULED,
      scheduledAt: window,
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
      status: LessonStatus.SCHEDULED,
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
 * Недоступності інструктора, що перетинають інтервал. Межі зберігаються
 * обидві, тож перетин рахує сама БД, без candidateWindow.
 */
export async function findInstructorTimeOffs(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    instructorId: string;
    interval: ScheduleSlot;
  },
): Promise<{ id: string; startsAt: Date; endsAt: Date }[]> {
  return tx.instructorTimeOff.findMany({
    where: {
      organizationId: input.organizationId,
      instructorId: input.instructorId,
      startsAt: { lt: input.interval.end },
      endsAt: { gt: input.interval.start },
    },
    select: { id: true, startsAt: true, endsAt: true },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  });
}

function timeOffConflict(
  instructorId: string,
  row: { id: string; startsAt: Date; endsAt: Date },
): LessonConflict {
  return {
    resource: 'INSTRUCTOR',
    resourceId: instructorId,
    lessonType: 'TIME_OFF',
    lessonId: row.id,
    scheduledAt: row.startsAt,
    endsAt: row.endsAt,
  };
}

/**
 * Нова недоступність інструктора: SCHEDULED-практика цього інструктора, що
 * її перетинає. Такі заняття адмін спершу скасовує чи переносить.
 */
export async function findTimeOffConflicts(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    instructorId: string;
    interval: ScheduleSlot;
  },
): Promise<LessonConflict[]> {
  const lessons = await tx.drivingLesson.findMany({
    where: {
      organizationId: input.organizationId,
      instructorId: input.instructorId,
      status: LessonStatus.SCHEDULED,
      scheduledAt: candidateWindow(input.interval),
    },
    select: { id: true, scheduledAt: true, durationMin: true },
  });
  return sortConflicts(
    lessons
      .filter((row) => overlaps(input.interval, row))
      .map((row) =>
        toConflict('INSTRUCTOR', input.instructorId, 'PRACTICE', row),
      ),
  );
}

/**
 * Практика: інші заняття цього інструктора, авто чи студента, теорія груп,
 * де студент має ACTIVE-зарахування, і недоступність інструктора.
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
      status: LessonStatus.SCHEDULED,
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
      organizationId: input.organizationId,
      status: LessonStatus.SCHEDULED,
      scheduledAt: window,
      group: {
        enrollments: {
          some: { studentId: input.studentId, status: EnrollmentStatus.ACTIVE },
        },
      },
    },
    select: { id: true, scheduledAt: true, durationMin: true },
  });

  const timeOffs = await findInstructorTimeOffs(tx, {
    organizationId: input.organizationId,
    instructorId: input.instructorId,
    interval: input.slot,
  });

  const conflicts: LessonConflict[] = [];
  for (const row of timeOffs) {
    conflicts.push(timeOffConflict(input.instructorId, row));
  }
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

/**
 * Слот практики: інші слоти цього інструктора чи авто і SCHEDULED-заняття з
 * ними. Жодне заняття ще не прив'язане до слоту, тож рахуються всі заняття.
 */
export async function findSlotConflicts(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    /** Слот, що змінюється; null для нового. */
    slotId: string | null;
    instructorId: string;
    carId: string;
    interval: ScheduleSlot;
  },
): Promise<LessonConflict[]> {
  const window = candidateWindow(input.interval);
  const resources = [
    { instructorId: input.instructorId },
    { carId: input.carId },
  ];
  const select = {
    id: true,
    instructorId: true,
    carId: true,
    scheduledAt: true,
    durationMin: true,
  } as const;

  const slots = await tx.practiceSlot.findMany({
    where: {
      ...(input.slotId === null ? {} : { id: { not: input.slotId } }),
      organizationId: input.organizationId,
      scheduledAt: window,
      OR: resources,
    },
    select,
  });
  const lessons = await tx.drivingLesson.findMany({
    where: {
      organizationId: input.organizationId,
      status: LessonStatus.SCHEDULED,
      scheduledAt: window,
      OR: resources,
    },
    select,
  });

  const conflicts: LessonConflict[] = [];
  const sources = [
    ['SLOT', slots],
    ['PRACTICE', lessons],
  ] as const;
  for (const [lessonType, rows] of sources) {
    for (const row of rows.filter((r) => overlaps(input.interval, r))) {
      if (row.instructorId === input.instructorId) {
        conflicts.push(
          toConflict('INSTRUCTOR', input.instructorId, lessonType, row),
        );
      }
      if (row.carId === input.carId) {
        conflicts.push(toConflict('CAR', input.carId, lessonType, row));
      }
    }
  }
  return sortConflicts(conflicts);
}

/** Заняття, що може зайняти час слоту. У теорії instructorId і carId — null. */
export type SlotBlocker = {
  instructorId: string | null;
  carId: string | null;
  studentId: string | null;
  scheduledAt: Date;
  durationMin: number;
};

/**
 * Зайнятість для списку доступних слотів: SCHEDULED-практика інструктора,
 * цих авто чи студента і SCHEDULED-теорія груп з ACTIVE-зарахуванням
 * студента. Ті самі правила, що в findPracticeConflicts, але одним набором
 * запитів на всі слоти.
 */
export async function findStudentSlotBlockers(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    studentId: string;
    instructorId: string;
    carIds: readonly string[];
    interval: ScheduleSlot;
  },
): Promise<SlotBlocker[]> {
  const window = candidateWindow(input.interval);

  const practice = await tx.drivingLesson.findMany({
    where: {
      organizationId: input.organizationId,
      status: LessonStatus.SCHEDULED,
      scheduledAt: window,
      OR: [
        { instructorId: input.instructorId },
        { carId: { in: [...input.carIds] } },
        { studentId: input.studentId },
      ],
    },
    select: {
      instructorId: true,
      carId: true,
      studentId: true,
      scheduledAt: true,
      durationMin: true,
    },
  });

  const theory = await tx.lesson.findMany({
    where: {
      organizationId: input.organizationId,
      status: LessonStatus.SCHEDULED,
      scheduledAt: window,
      group: {
        enrollments: {
          some: { studentId: input.studentId, status: EnrollmentStatus.ACTIVE },
        },
      },
    },
    select: { scheduledAt: true, durationMin: true },
  });

  return [
    ...practice,
    ...theory.map((row) => ({
      ...row,
      instructorId: null,
      carId: null,
      studentId: input.studentId,
    })),
  ];
}

/**
 * Слот вільний, якщо жодне заняття того самого інструктора, авто чи
 * студента його не перетинає. Межі напіввідкриті, як в overlaps.
 */
export function isSlotFree(
  slot: {
    instructorId: string;
    carId: string;
    scheduledAt: Date;
    durationMin: number;
  },
  blockers: readonly SlotBlocker[],
  studentId: string,
): boolean {
  const interval = lessonSlot(slot.scheduledAt, slot.durationMin);
  return !blockers.some(
    (row) =>
      overlaps(interval, row) &&
      (row.instructorId === slot.instructorId ||
        row.carId === slot.carId ||
        row.studentId === studentId),
  );
}
