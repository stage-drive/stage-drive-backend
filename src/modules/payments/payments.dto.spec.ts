import { BadRequestException, Type, ValidationPipe } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { validationExceptionFactory } from '../../common/validation/field-error';
import { UNSAFE_TEXT_MESSAGE } from '../../common/validators/plain-text.decorator';
import {
  AMOUNT_MAX_MESSAGE,
  AMOUNT_NEGATIVE_MESSAGE,
  AMOUNT_NUMBER_MESSAGE,
  COMMENT_LENGTH_MESSAGE,
  CURRENCY_MESSAGE,
  CreatePaymentDto,
  DATE_FORMAT_MESSAGE,
  ListPaymentsQueryDto,
  PAYMENT_COMMENT_MAX_LENGTH,
  PAYMENT_STATUS_MESSAGE,
  PaymentHistoryQueryDto,
  REQUIRED_FIELD_MESSAGE,
  UpdatePaymentDto,
  UpdatePaymentStatusDto,
} from './payments.dto';

// Ті самі опції, що в configureApp: DTO перевіряються так, як їх запускає API.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  stopAtFirstError: true,
  exceptionFactory: validationExceptionFactory,
});

function validate(
  metatype: Type<unknown>,
  body: unknown,
  type: 'body' | 'query' = 'body',
): Promise<unknown> {
  return pipe.transform(body, { type, metatype });
}

async function errorsFor(
  metatype: Type<unknown>,
  body: unknown,
  type: 'body' | 'query' = 'body',
): Promise<unknown> {
  try {
    await validate(metatype, body, type);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse();
  }
  throw new Error('Expected validation to fail');
}

function fieldErrors(field: string, message: string) {
  return { statusCode: 400, errors: [{ field, message }] };
}

const STUDENT_ID = '88888888-8888-4888-8888-888888888888';

describe('CreatePaymentDto', () => {
  const valid = { studentId: STUDENT_ID, amount: 5000, paidAt: '2026-08-10' };

  it('accepts a minimal PAID payment and uppercases the currency', async () => {
    await expect(
      validate(CreatePaymentDto, { ...valid, currency: ' usd ' }),
    ).resolves.toEqual({ ...valid, currency: 'USD' });
  });

  it('accepts two decimal places and a trimmed comment', async () => {
    await expect(
      validate(CreatePaymentDto, {
        ...valid,
        amount: 5000.5,
        status: PaymentStatus.PAID,
        comment: '  Готівка  ',
      }),
    ).resolves.toEqual({
      ...valid,
      amount: 5000.5,
      status: PaymentStatus.PAID,
      comment: 'Готівка',
    });
  });

  it('drops a blank comment', async () => {
    await expect(
      validate(CreatePaymentDto, { ...valid, comment: '   ' }),
    ).resolves.toEqual(valid);
  });

  it.each([
    ['studentId missing', { amount: 1 }, 'studentId', REQUIRED_FIELD_MESSAGE],
    [
      'studentId not a UUID',
      { studentId: 'student-1', amount: 1 },
      'studentId',
      'studentId має бути UUID.',
    ],
    [
      'amount missing',
      { studentId: STUDENT_ID },
      'amount',
      REQUIRED_FIELD_MESSAGE,
    ],
    [
      'amount as a string',
      { studentId: STUDENT_ID, amount: '5000' },
      'amount',
      AMOUNT_NUMBER_MESSAGE,
    ],
    [
      'amount with three decimals',
      { studentId: STUDENT_ID, amount: 10.123 },
      'amount',
      AMOUNT_NUMBER_MESSAGE,
    ],
    [
      'negative amount',
      { studentId: STUDENT_ID, amount: -1 },
      'amount',
      AMOUNT_NEGATIVE_MESSAGE,
    ],
    [
      'amount above DECIMAL(12,2)',
      { studentId: STUDENT_ID, amount: 10_000_000_000 },
      'amount',
      AMOUNT_MAX_MESSAGE,
    ],
    [
      'unknown currency',
      { studentId: STUDENT_ID, amount: 1, currency: 'XYZ' },
      'currency',
      CURRENCY_MESSAGE,
    ],
    [
      'unknown status',
      { studentId: STUDENT_ID, amount: 1, status: 'REFUNDED' },
      'status',
      PAYMENT_STATUS_MESSAGE,
    ],
    [
      'malformed paidAt',
      { studentId: STUDENT_ID, amount: 1, paidAt: '10.08.2026' },
      'paidAt',
      DATE_FORMAT_MESSAGE,
    ],
    [
      'comment with markup',
      { studentId: STUDENT_ID, amount: 1, comment: '<b>x</b>' },
      'comment',
      UNSAFE_TEXT_MESSAGE,
    ],
    [
      'comment too long',
      {
        studentId: STUDENT_ID,
        amount: 1,
        comment: 'x'.repeat(PAYMENT_COMMENT_MAX_LENGTH + 1),
      },
      'comment',
      COMMENT_LENGTH_MESSAGE,
    ],
  ])('rejects %s', async (_case, body, field, message) => {
    await expect(errorsFor(CreatePaymentDto, body)).resolves.toEqual(
      fieldErrors(field, message),
    );
  });

  it.each(['organizationId', 'createdById'])(
    'rejects %s in the body',
    async (field) => {
      await expect(
        errorsFor(CreatePaymentDto, { ...valid, [field]: STUDENT_ID }),
      ).resolves.toEqual(
        fieldErrors(field, `property ${field} should not exist`),
      );
    },
  );
});

describe('UpdatePaymentDto', () => {
  it('turns a blank comment into null so it clears the field', async () => {
    await expect(
      validate(UpdatePaymentDto, { comment: '  ' }),
    ).resolves.toEqual({ comment: null });
  });

  it('accepts comment: null', async () => {
    await expect(
      validate(UpdatePaymentDto, { comment: null }),
    ).resolves.toEqual({ comment: null });
  });

  it.each([
    ['amount', AMOUNT_NUMBER_MESSAGE],
    ['currency', CURRENCY_MESSAGE],
  ])(
    'rejects %s: null with 400 instead of passing it on',
    async (field, message) => {
      await expect(
        errorsFor(UpdatePaymentDto, { [field]: null }),
      ).resolves.toEqual(fieldErrors(field, message));
    },
  );

  it('rejects paidAt: null, because a payment date cannot be cleared', async () => {
    await expect(
      errorsFor(UpdatePaymentDto, { paidAt: null }),
    ).resolves.toEqual(fieldErrors('paidAt', DATE_FORMAT_MESSAGE));
  });

  it('rejects status: it changes only through PATCH /payments/:id/status', async () => {
    await expect(
      errorsFor(UpdatePaymentDto, { status: PaymentStatus.PAID }),
    ).resolves.toEqual(
      fieldErrors('status', 'property status should not exist'),
    );
  });
});

describe('UpdatePaymentStatusDto', () => {
  it('requires status', async () => {
    await expect(errorsFor(UpdatePaymentStatusDto, {})).resolves.toEqual(
      fieldErrors('status', REQUIRED_FIELD_MESSAGE),
    );
  });

  it('accepts status with an optional paidAt and comment', async () => {
    await expect(
      validate(UpdatePaymentStatusDto, {
        status: PaymentStatus.PAID,
        paidAt: '2026-08-10T12:00:00Z',
        comment: 'Підтверджено банком',
      }),
    ).resolves.toEqual({
      status: PaymentStatus.PAID,
      paidAt: '2026-08-10T12:00:00Z',
      comment: 'Підтверджено банком',
    });
  });
});

describe('ListPaymentsQueryDto', () => {
  it('converts page and limit and drops a blank search', async () => {
    await expect(
      validate(
        ListPaymentsQueryDto,
        { page: '2', limit: '50', search: '  ', status: 'NOT_PAID' },
        'query',
      ),
    ).resolves.toEqual({ page: 2, limit: 50, status: PaymentStatus.NOT_PAID });
  });

  it.each([
    ['sortBy', { sortBy: 'amount' }],
    ['limit', { limit: '101' }],
    ['groupId', { groupId: 'group-1' }],
  ])('rejects an invalid %s', async (field, query) => {
    const response = (await errorsFor(
      ListPaymentsQueryDto,
      query,
      'query',
    )) as {
      errors: { field: string }[];
    };
    expect(response.errors[0].field).toBe(field);
  });
});

describe('PaymentHistoryQueryDto', () => {
  it('accepts filters and a date range', async () => {
    await expect(
      validate(
        PaymentHistoryQueryDto,
        {
          studentId: STUDENT_ID,
          action: 'STATUS_CHANGED',
          from: '2026-08-01',
          to: '2026-09-01',
        },
        'query',
      ),
    ).resolves.toEqual({
      studentId: STUDENT_ID,
      action: 'STATUS_CHANGED',
      from: '2026-08-01',
      to: '2026-09-01',
    });
  });

  it('rejects an unknown action', async () => {
    await expect(
      errorsFor(PaymentHistoryQueryDto, { action: 'DELETED' }, 'query'),
    ).resolves.toEqual(
      fieldErrors(
        'action',
        'action має бути CREATED, STATUS_CHANGED або UPDATED.',
      ),
    );
  });
});
