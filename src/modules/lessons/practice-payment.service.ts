import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { readCurrentPaymentStatus } from '../payments/current-payment-status';

export const PRACTICE_PAYMENT_REQUIRED_MESSAGE =
  'Немає доступу до практики. Очікується оплата.';

/**
 * Єдине місце, де вирішується доступ до практики за оплатою (Модуль 13).
 * Теорію проходять і з NOT_PAID, а практичне заняття записується лише з
 * актуальним статусом PAID — статусом останньої оплати студента. Інакше 422.
 *
 * Бронювання студента й створення заняття адміном викликають метод у тій самій
 * транзакції, що й запис заняття, після блокування студента
 * (scheduleLockKey('student', id)). Тим самим блокуванням серіалізуються записи
 * PaymentsService, тож статус не зміниться між перевіркою і створенням заняття.
 *
 * Повертає статус для знімка DrivingLesson.paymentStatus — завжди PAID.
 */
@Injectable()
export class PracticePaymentService {
  async resolveForLesson(
    tx: Prisma.TransactionClient,
    input: { organizationId: string; studentId: string },
  ): Promise<PaymentStatus> {
    const status = await readCurrentPaymentStatus(
      tx,
      input.organizationId,
      input.studentId,
    );
    if (status !== PaymentStatus.PAID) {
      throw new UnprocessableEntityException(PRACTICE_PAYMENT_REQUIRED_MESSAGE);
    }
    return PaymentStatus.PAID;
  }
}
