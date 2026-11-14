import { PaymentStatus, Prisma } from '@prisma/client';
import { currentStatusOf } from './payment-view';

/**
 * Актуальний статус оплати студента — status його останнього Payment за createdAt
 * (Student.currentPaymentId). Без профілю чи без жодної оплати — NOT_PAID.
 *
 * studentId — id користувача-студента. Складений FK students.current_payment_id
 * гарантує, що вказівник веде лише на оплату цього самого студента.
 *
 * Викликайте в транзакції, яка вже тримає блокування студента
 * (scheduleLockKey('student', studentId)): ним же серіалізуються записи оплат.
 */
export async function readCurrentPaymentStatus(
  tx: Prisma.TransactionClient,
  organizationId: string,
  studentId: string,
): Promise<PaymentStatus> {
  const profile = await tx.student.findFirst({
    where: { userId: studentId, organizationId },
    select: { currentPayment: { select: { status: true } } },
  });
  return currentStatusOf(profile?.currentPayment);
}
