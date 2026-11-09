import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, User, UserRole } from '@prisma/client';
import { lockPracticeLesson } from '../../common/prisma/schedule-lock';
import { lessonPersonSelect, practiceLessonViewSelect } from './lesson-view';
import { LESSON_NOT_FOUND_MESSAGE } from './lessons.dto';
import { practiceStudentSelect } from './practice-rules';

/**
 * Рядок практичного заняття для змін: спільний для LessonsService (зміна,
 * перенесення, скасування) і PracticeLessonWorkflowService (підтвердження,
 * відхилення).
 */

/** Надмножина practiceLessonViewSelect: решта полів потрібна перевіркам запису. */
export const practiceLessonSelect = {
  ...practiceLessonViewSelect,
  instructorId: true,
  studentId: true,
  carId: true,
  instructor: {
    select: {
      ...lessonPersonSelect,
      role: true,
      status: true,
      deletedAt: true,
    },
  },
  student: { select: practiceStudentSelect },
} satisfies Prisma.DrivingLessonSelect;

export type PracticeLessonRow = Prisma.DrivingLessonGetPayload<{
  select: typeof practiceLessonSelect;
}>;

/**
 * Блокує заняття (FOR UPDATE) і читає його. Паралельна зміна того самого
 * заняття чекає на цю транзакцію. Заняття іншої організації — 404, чуже
 * заняття для INSTRUCTOR чи STUDENT — 403.
 */
export async function lockPracticeLessonForChange(
  tx: Prisma.TransactionClient,
  actor: User,
  lessonId: string,
): Promise<PracticeLessonRow> {
  await lockPracticeLesson(tx, lessonId, actor.organizationId);
  const lesson = await tx.drivingLesson.findFirst({
    where: { id: lessonId, organizationId: actor.organizationId },
    select: practiceLessonSelect,
  });
  if (!lesson) {
    throw new NotFoundException(LESSON_NOT_FOUND_MESSAGE);
  }
  if (
    (actor.role === UserRole.INSTRUCTOR && lesson.instructorId !== actor.id) ||
    (actor.role === UserRole.STUDENT && lesson.studentId !== actor.id)
  ) {
    throw new ForbiddenException('Insufficient permissions');
  }
  return lesson;
}
