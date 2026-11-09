import { Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';

/**
 * Єдине місце, де визначається оплата практичного заняття. Оплат у системі
 * ще немає, тож кожне заняття вважається оплаченим (PAID).
 *
 * Коли з'являться оплати, тут перевірятиметься пакет чи рахунок студента:
 * метод повертатиме UNPAID або кидатиме 409, якщо без оплати бронювати не
 * можна. Бронювання й створення заняття адміном уже викликають його в тій самій
 * транзакції, що й запис заняття.
 */
@Injectable()
export class PracticePaymentService {
  /* eslint-disable @typescript-eslint/no-unused-vars --
     tx і input — контракт для майбутньої перевірки оплати; заглушка їх не читає. */
  resolveForLesson(
    tx: Prisma.TransactionClient,
    input: { organizationId: string; studentId: string },
  ): Promise<PaymentStatus> {
    return Promise.resolve(PaymentStatus.PAID);
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}
