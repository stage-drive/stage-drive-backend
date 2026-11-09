import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  CarStatus,
  EnrollmentStatus,
  LicenseCategory,
  Prisma,
  TrainingStatus,
  Transmission,
  UserRole,
  UserStatus,
} from '@prisma/client';
import {
  lockScheduleResources,
  scheduleLockKey,
} from '../../common/prisma/schedule-lock';
import {
  CAR_NOT_FOUND_MESSAGE,
  INSTRUCTOR_NOT_ACTIVE_MESSAGE,
  INSTRUCTOR_NOT_FOUND_MESSAGE,
  INSTRUCTOR_ROLE_MESSAGE,
} from '../cars/cars.service';
import {
  CAR_NOT_ASSIGNED_MESSAGE,
  CAR_NOT_AVAILABLE_MESSAGE,
  INSTRUCTOR_CAR_MISMATCH_MESSAGE,
} from '../students/students.service';
import { lessonPersonSelect } from './lesson-view';

/**
 * Перевірки студента, інструктора й авто практики. Спільні для практичних
 * занять (LessonsService) і бронювання (PracticeLessonsService).
 */

export const STUDENT_NOT_IN_PRACTICE_MESSAGE =
  'Студент має бути активним і мати допуск до практики (PRACTICE).';

/** Студент практики з профілем: допуск, категорія, коробка, призначені інструктор і авто. */
export const practiceStudentSelect = {
  ...lessonPersonSelect,
  status: true,
  deletedAt: true,
  studentProfile: {
    select: {
      trainingStatus: true,
      category: true,
      transmission: true,
      instructorId: true,
      carId: true,
    },
  },
} satisfies Prisma.UserSelect;

export type PracticeStudentRow = Prisma.UserGetPayload<{
  select: typeof practiceStudentSelect;
}>;

/**
 * Допуск до практики вже має бути (PRACTICE). ACTIVE тут не підходить, хоча
 * isEligibleForPractice у students його приймає: там перевіряється право
 * отримати допуск.
 */
export function requirePracticeProfile(student: PracticeStudentRow) {
  const profile = student.studentProfile;
  if (
    student.deletedAt ||
    student.status !== UserStatus.ACTIVE ||
    !profile ||
    profile.trainingStatus !== TrainingStatus.PRACTICE
  ) {
    throw new ConflictException(STUDENT_NOT_IN_PRACTICE_MESSAGE);
  }
  return profile;
}

export function assertInstructorActive(instructor: {
  role: UserRole;
  status: UserStatus;
  deletedAt: Date | null;
}): void {
  if (instructor.role !== UserRole.INSTRUCTOR) {
    throw new ConflictException(INSTRUCTOR_ROLE_MESSAGE);
  }
  if (instructor.deletedAt || instructor.status !== UserStatus.ACTIVE) {
    throw new ConflictException(INSTRUCTOR_NOT_ACTIVE_MESSAGE);
  }
}

/** Те саме правило, що CarsService.requireInstructor. */
export async function requireInstructor(
  tx: Prisma.TransactionClient,
  organizationId: string,
  instructorId: string,
): Promise<void> {
  const instructor = await tx.user.findUnique({
    where: { id: instructorId },
    select: {
      organizationId: true,
      role: true,
      status: true,
      deletedAt: true,
    },
  });
  if (
    !instructor ||
    instructor.deletedAt ||
    instructor.organizationId !== organizationId
  ) {
    throw new NotFoundException(INSTRUCTOR_NOT_FOUND_MESSAGE);
  }
  assertInstructorActive(instructor);
}

/** Те саме правило авто, що StudentsService.grantPracticeAccess. */
export async function requirePracticeCar(
  tx: Prisma.TransactionClient,
  organizationId: string,
  carId: string,
  expected: {
    instructorId: string;
    category: LicenseCategory | null;
    transmission: Transmission | null;
  },
): Promise<void> {
  const car = await tx.car.findUnique({
    where: { id: carId },
    select: {
      organizationId: true,
      instructorId: true,
      category: true,
      transmission: true,
      status: true,
    },
  });
  if (!car || car.organizationId !== organizationId) {
    throw new NotFoundException(CAR_NOT_FOUND_MESSAGE);
  }
  if (
    car.instructorId !== expected.instructorId ||
    car.category !== expected.category ||
    car.transmission !== expected.transmission
  ) {
    throw new ConflictException(INSTRUCTOR_CAR_MISMATCH_MESSAGE);
  }
  if (car.status !== CarStatus.AVAILABLE) {
    throw new ConflictException(CAR_NOT_AVAILABLE_MESSAGE);
  }
}

/**
 * Авто слоту: з організації, закріплене за інструктором слоту, AVAILABLE.
 * Категорію й коробку перевірятиме бронювання: студента в слоті ще немає.
 */
export async function requireSlotCar(
  tx: Prisma.TransactionClient,
  organizationId: string,
  carId: string,
  instructorId: string,
): Promise<void> {
  const car = await tx.car.findUnique({
    where: { id: carId },
    select: { organizationId: true, instructorId: true, status: true },
  });
  if (!car || car.organizationId !== organizationId) {
    throw new NotFoundException(CAR_NOT_FOUND_MESSAGE);
  }
  if (!car.instructorId) {
    throw new ConflictException(CAR_NOT_ASSIGNED_MESSAGE);
  }
  if (car.instructorId !== instructorId) {
    throw new ConflictException(INSTRUCTOR_CAR_MISMATCH_MESSAGE);
  }
  if (car.status !== CarStatus.AVAILABLE) {
    throw new ConflictException(CAR_NOT_AVAILABLE_MESSAGE);
  }
}

/**
 * Advisory-ключі практичного заняття: інструктор, авто, студент і його групи з
 * ACTIVE-зарахуванням. Спільний ключ group: серіалізує практику студента з
 * теорією його групи. Ті самі ключі беруть створення, зміна і бронювання
 * заняття, тож паралельний запис не проскочить між перевіркою і записом.
 */
export async function lockPracticeResources(
  tx: Prisma.TransactionClient,
  input: { instructorId: string; carId: string; studentId: string },
): Promise<void> {
  const studentGroups = await tx.enrollment.findMany({
    where: { studentId: input.studentId, status: EnrollmentStatus.ACTIVE },
    select: { groupId: true },
  });
  await lockScheduleResources(tx, [
    scheduleLockKey('instructor', input.instructorId),
    scheduleLockKey('car', input.carId),
    scheduleLockKey('student', input.studentId),
    ...studentGroups.map((row) => scheduleLockKey('group', row.groupId)),
  ]);
}
