import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingConfirmation,
  LessonStatus,
  User,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CONFIRMATION_DEADLINE_HOURS } from './availability';
import { practiceBookingStatus, toPracticeLessonDto } from './lesson-view';
import { CancelLessonDto, PracticeLessonDto } from './lessons.dto';
import {
  PracticeLessonOutcomeDto,
  UpdatePracticeCommentDto,
} from './practice-lessons.dto';
import {
  PracticeLessonRow,
  lockPracticeLessonForChange,
  practiceLessonSelect,
} from './practice-lesson-row';
import {
  requireInstructor,
  requirePracticeCar,
  requirePracticeProfile,
} from './practice-rules';

/** Підтверджує й відхиляє лише інструктор заняття або ADMIN. */
export const PRACTICE_CONFIRM_ROLES = [
  UserRole.ADMIN,
  UserRole.INSTRUCTOR,
] as const;

export const BOOKING_NOT_PENDING_MESSAGE =
  'Підтвердити чи відхилити можна лише запит, що чекає підтвердження.';
export const BOOKING_CONFIRMATION_EXPIRED_MESSAGE = `Запит прострочено: підтвердити можна не пізніше ніж за ${CONFIRMATION_DEADLINE_HOURS} години до початку.`;
export const PRACTICE_CAR_MISSING_MESSAGE =
  'У заняття немає автомобіля: підтвердити його не можна.';
export const BOOKING_REJECTED_DEFAULT_REASON = 'Інструктор відхилив запит';

/** Результат і коментар фіксують ті самі ролі: інструктор заняття або ADMIN. */
export const PRACTICE_OUTCOME_ROLES = PRACTICE_CONFIRM_ROLES;

export const LESSON_OUTCOME_NOT_ALLOWED_MESSAGE =
  'Результат можна зафіксувати лише для підтвердженого запланованого заняття.';
export const LESSON_OUTCOME_TOO_EARLY_MESSAGE =
  'Заняття ще не почалося: результат можна зафіксувати після його початку.';
export const LESSON_COMMENT_CANCELLED_MESSAGE =
  'До скасованого заняття коментар не додається.';

const HOUR_MS = 60 * 60_000;

function assertRole(actor: User, roles: readonly UserRole[]): void {
  if (!roles.includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

/**
 * Лише SCHEDULED + PENDING. 409 несе bookingStatus, щоб клієнт оновив
 * картку (зокрема коли запит щойно відхилило фонове завдання).
 */
function assertPending(lesson: PracticeLessonRow): void {
  if (
    lesson.status !== LessonStatus.SCHEDULED ||
    lesson.confirmationStatus !== BookingConfirmation.PENDING
  ) {
    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message: BOOKING_NOT_PENDING_MESSAGE,
      currentStatus: practiceBookingStatus(lesson),
    });
  }
}

/**
 * Життєвий цикл практичного заняття після бронювання: інструктор заняття або
 * ADMIN підтверджує чи відхиляє запит студента, а після початку фіксує
 * результат (проведено / неявка) і коментар. Заняття блокується (FOR UPDATE)
 * тим самим хелпером, що й зміни в LessonsService, тож гонка з
 * PracticeRequestExpiryJob чи паралельним скасуванням дає одного переможця.
 * Час заняття не змінюється: PENDING уже займав його, тож advisory-ключі й
 * пошук конфліктів не потрібні.
 */
@Injectable()
export class PracticeLessonWorkflowService {
  private readonly logger = new Logger(PracticeLessonWorkflowService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * PENDING → CONFIRMED не пізніше ніж за CONFIRMATION_DEADLINE_HOURS до
   * початку. Інструктор і авто перевіряються ще раз: між бронюванням і
   * підтвердженням інструктора могли заблокувати, а авто — відправити на ремонт.
   */
  async confirm(actor: User, lessonId: string): Promise<PracticeLessonDto> {
    assertRole(actor, PRACTICE_CONFIRM_ROLES);
    await this.requireOrganization(actor.organizationId);
    const now = new Date();

    const saved = await this.prisma.$transaction(async (tx) => {
      const lesson = await lockPracticeLessonForChange(tx, actor, lessonId);
      assertPending(lesson);
      if (
        lesson.scheduledAt.getTime() - now.getTime() <
        CONFIRMATION_DEADLINE_HOURS * HOUR_MS
      ) {
        throw new ConflictException(BOOKING_CONFIRMATION_EXPIRED_MESSAGE);
      }

      const profile = requirePracticeProfile(lesson.student);
      await requireInstructor(tx, actor.organizationId, lesson.instructorId);
      if (!lesson.carId) {
        throw new ConflictException(PRACTICE_CAR_MISSING_MESSAGE);
      }
      await requirePracticeCar(tx, actor.organizationId, lesson.carId, {
        instructorId: lesson.instructorId,
        category: profile.category,
        transmission: profile.transmission,
      });

      return tx.drivingLesson.update({
        where: { id: lesson.id },
        data: {
          confirmationStatus: BookingConfirmation.CONFIRMED,
          confirmedAt: now,
          confirmedById: actor.id,
        },
        select: practiceLessonSelect,
      });
    });

    this.logger.log(
      `Practice booking confirmed lessonId=${saved.id} scheduledAt=${saved.scheduledAt.toISOString()} actorId=${actor.id} organizationId=${actor.organizationId}`,
    );
    return toPracticeLessonDto(saved);
  }

  /**
   * PENDING → REJECTED: заняття скасовується з аудитом, і час звільняється.
   * Дедлайну немає: відхилити можна, поки запит чекає.
   */
  async reject(
    actor: User,
    lessonId: string,
    payload: CancelLessonDto,
  ): Promise<PracticeLessonDto> {
    assertRole(actor, PRACTICE_CONFIRM_ROLES);
    await this.requireOrganization(actor.organizationId);
    const now = new Date();

    const saved = await this.prisma.$transaction(async (tx) => {
      const lesson = await lockPracticeLessonForChange(tx, actor, lessonId);
      assertPending(lesson);

      return tx.drivingLesson.update({
        where: { id: lesson.id },
        data: {
          status: LessonStatus.CANCELLED,
          confirmationStatus: BookingConfirmation.REJECTED,
          cancelledAt: now,
          cancelledById: actor.id,
          cancellationReason: payload.reason ?? BOOKING_REJECTED_DEFAULT_REASON,
        },
        select: practiceLessonSelect,
      });
    });

    this.logger.log(
      `Practice booking rejected lessonId=${saved.id} scheduledAt=${saved.scheduledAt.toISOString()} actorId=${actor.id} organizationId=${actor.organizationId}`,
    );
    return toPracticeLessonDto(saved);
  }

  /**
   * Коментар інструктора до будь-якого не скасованого заняття: запланованого,
   * проведеного чи з неявкою. Замінює попередній; бачить і студент.
   */
  async updateComment(
    actor: User,
    lessonId: string,
    payload: UpdatePracticeCommentDto,
  ): Promise<PracticeLessonDto> {
    assertRole(actor, PRACTICE_OUTCOME_ROLES);
    await this.requireOrganization(actor.organizationId);

    const saved = await this.prisma.$transaction(async (tx) => {
      const lesson = await lockPracticeLessonForChange(tx, actor, lessonId);
      if (lesson.status === LessonStatus.CANCELLED) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message: LESSON_COMMENT_CANCELLED_MESSAGE,
          currentStatus: practiceBookingStatus(lesson),
        });
      }
      return tx.drivingLesson.update({
        where: { id: lesson.id },
        data: { instructorComment: payload.comment },
        select: practiceLessonSelect,
      });
    });

    this.logger.log(
      `Practice lesson comment updated lessonId=${saved.id} actorId=${actor.id} organizationId=${actor.organizationId}`,
    );
    return toPracticeLessonDto(saved);
  }

  /**
   * Результат заняття: COMPLETED (відбулося) чи NO_SHOW (студент не прийшов).
   * Лише для підтвердженого запланованого заняття, що вже почалося (CHECK у БД
   * теж не дає результату без підтвердження). Коментар, якщо переданий,
   * замінює попередній; без нього попередній лишається.
   */
  async recordOutcome(
    actor: User,
    lessonId: string,
    payload: PracticeLessonOutcomeDto,
  ): Promise<PracticeLessonDto> {
    const { result: status, comment } = payload;
    assertRole(actor, PRACTICE_OUTCOME_ROLES);
    await this.requireOrganization(actor.organizationId);
    const now = new Date();

    const saved = await this.prisma.$transaction(async (tx) => {
      const lesson = await lockPracticeLessonForChange(tx, actor, lessonId);
      if (
        lesson.status !== LessonStatus.SCHEDULED ||
        lesson.confirmationStatus !== BookingConfirmation.CONFIRMED
      ) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message: LESSON_OUTCOME_NOT_ALLOWED_MESSAGE,
          currentStatus: practiceBookingStatus(lesson),
        });
      }
      if (now.getTime() < lesson.scheduledAt.getTime()) {
        throw new ConflictException(LESSON_OUTCOME_TOO_EARLY_MESSAGE);
      }

      return tx.drivingLesson.update({
        where: { id: lesson.id },
        data: {
          status,
          outcomeAt: now,
          outcomeById: actor.id,
          ...(comment === undefined ? {} : { instructorComment: comment }),
        },
        select: practiceLessonSelect,
      });
    });

    this.logger.log(
      `Practice lesson outcome recorded lessonId=${saved.id} status=${saved.status} actorId=${actor.id} organizationId=${actor.organizationId}`,
    );
    return toPracticeLessonDto(saved);
  }

  private async requireOrganization(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization || organization.deletedAt) {
      throw new NotFoundException('Organization not found');
    }
    return organization;
  }
}
