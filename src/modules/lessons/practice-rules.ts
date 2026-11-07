import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  CarStatus,
  LicenseCategory,
  Prisma,
  Transmission,
  UserRole,
  UserStatus,
} from '@prisma/client';
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

/**
 * Перевірки інструктора й авто практики. Спільні для практичних занять
 * (LessonsService) і слотів (PracticeSlotsService).
 */

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
