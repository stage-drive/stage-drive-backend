import { UnprocessableEntityException } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import {
  PRACTICE_PAYMENT_REQUIRED_MESSAGE,
  PracticePaymentService,
} from './practice-payment.service';

describe('PracticePaymentService', () => {
  const tx = { student: { findFirst: jest.fn() } };
  const input = { organizationId: 'org-1', studentId: 'student-1' };
  const service = new PracticePaymentService();

  function resolve() {
    return service.resolveForLesson(
      tx as unknown as Prisma.TransactionClient,
      input,
    );
  }

  beforeEach(() => {
    tx.student.findFirst.mockReset();
  });

  it('allows practice when the latest payment is PAID', async () => {
    tx.student.findFirst.mockResolvedValue({
      currentPayment: { status: PaymentStatus.PAID },
    });

    await expect(resolve()).resolves.toBe(PaymentStatus.PAID);
    expect(tx.student.findFirst).toHaveBeenCalledWith({
      where: { userId: 'student-1', organizationId: 'org-1' },
      select: { currentPayment: { select: { status: true } } },
    });
  });

  it.each([
    ['no student profile', null],
    ['no payments yet', { currentPayment: null }],
    [
      'the latest payment is NOT_PAID',
      {
        currentPayment: { status: PaymentStatus.NOT_PAID },
      },
    ],
  ])('returns 422 when %s', async (_case, profile) => {
    tx.student.findFirst.mockResolvedValue(profile);

    await expect(resolve()).rejects.toThrow(
      new UnprocessableEntityException(PRACTICE_PAYMENT_REQUIRED_MESSAGE),
    );
  });

  it('uses the exact PRD message', () => {
    expect(PRACTICE_PAYMENT_REQUIRED_MESSAGE).toBe(
      'Немає доступу до практики. Очікується оплата.',
    );
  });
});
