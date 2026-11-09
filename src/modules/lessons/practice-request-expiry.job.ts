import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { BookingConfirmation, LessonStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CONFIRMATION_DEADLINE_HOURS } from './availability';

export const BOOKING_EXPIRED_REASON = 'Інструктор не підтвердив запит вчасно';

/** Як часто шукати прострочені запити. Запізнення відхилення — не більше за інтервал. */
const POLL_INTERVAL_MS = 60_000;
const HOUR_MS = 60 * 60_000;

/** Як у InvitationEmailQueue: будь-що кинуте → Error для логу. */
function unknownError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === 'string') {
    return new Error(error);
  }
  return new Error('Unknown error');
}

/**
 * Відхиляє запити на бронювання, які ніхто не підтвердив за
 * CONFIRMATION_DEADLINE_HOURS до початку: заняття скасовується з
 * confirmationStatus = REJECTED, і час знову вільний.
 *
 * Кожен запуск — один UPDATE: Postgres блокує кожен рядок і перевіряє WHERE
 * ще раз після очікування. Тому кілька екземплярів застосунку не заважають
 * одне одному, а гонка з підтвердженням (воно теж блокує рядок) дає одного
 * переможця. cancelledById лишається null: відхилила система.
 * Розклад запусків — як у InvitationEmailQueue: setInterval з unref.
 */
@Injectable()
export class PracticeRequestExpiryJob
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PracticeRequestExpiryJob.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, POLL_INTERVAL_MS);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Один прохід; повертає кількість відхилених запитів. */
  async expireOverdue(now: Date = new Date()): Promise<number> {
    const deadline = new Date(
      now.getTime() + CONFIRMATION_DEADLINE_HOURS * HOUR_MS,
    );
    const { count } = await this.prisma.drivingLesson.updateMany({
      where: {
        status: LessonStatus.SCHEDULED,
        confirmationStatus: BookingConfirmation.PENDING,
        scheduledAt: { lte: deadline },
      },
      data: {
        status: LessonStatus.CANCELLED,
        confirmationStatus: BookingConfirmation.REJECTED,
        cancelledAt: now,
        cancellationReason: BOOKING_EXPIRED_REASON,
      },
    });
    if (count > 0) {
      this.logger.log(`Practice booking requests expired count=${count}`);
    }
    return count;
  }

  /** Не запускає новий прохід, поки попередній не закінчився. */
  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.expireOverdue();
    } catch (error) {
      const err = unknownError(error);
      this.logger.error(
        `Failed to expire practice booking requests: ${err.message}`,
        err.stack,
      );
    } finally {
      this.running = false;
    }
  }
}
