import { BadRequestException } from '@nestjs/common';
import {
  IDEMPOTENCY_KEY_FORMAT_MESSAGE,
  IDEMPOTENCY_KEY_HEADER,
  PaymentCreateFingerprint,
  hashCreateRequest,
  parseIdempotencyKey,
} from './payment-idempotency';

describe('parseIdempotencyKey', () => {
  it.each([undefined, '', '   '])(
    'treats %p as no key: the request is simply not idempotent',
    (value) => {
      expect(parseIdempotencyKey(value)).toBeNull();
    },
  );

  it.each([
    '3f0c2a6e-6b1d-4f7e-9c2a-1b2c3d4e5f60',
    'payment:2026-08-10:student-1',
    'abc_DEF.123',
  ])('accepts %s', (key) => {
    expect(parseIdempotencyKey(`  ${key} `)).toBe(key);
  });

  it.each(['short', 'has space inside', 'ключ-кирилицею', 'x'.repeat(129)])(
    'rejects %p with a 400 field error',
    (key) => {
      let error: unknown;
      try {
        parseIdempotencyKey(key);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        statusCode: 400,
        errors: [
          {
            field: IDEMPOTENCY_KEY_HEADER,
            message: IDEMPOTENCY_KEY_FORMAT_MESSAGE,
          },
        ],
      });
    },
  );
});

describe('hashCreateRequest', () => {
  const request: PaymentCreateFingerprint = {
    studentId: '88888888-8888-4888-8888-888888888888',
    amount: '5000.00',
    currency: 'UAH',
    status: 'PAID',
    paidAt: '2026-08-10T00:00:00.000Z',
    purpose: 'Курс теорії',
    comment: null,
  };

  it('is a stable SHA-256 hex digest', () => {
    expect(hashCreateRequest(request)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCreateRequest({ ...request })).toBe(hashCreateRequest(request));
  });

  it.each<[keyof PaymentCreateFingerprint, string | null]>([
    ['studentId', '99999999-9999-4999-8999-999999999999'],
    ['amount', '5000.01'],
    ['currency', 'USD'],
    ['status', 'NOT_PAID'],
    ['paidAt', null],
    ['purpose', 'Практика'],
    ['comment', 'Готівка'],
  ])('changes when %s changes', (field, value) => {
    expect(hashCreateRequest({ ...request, [field]: value })).not.toBe(
      hashCreateRequest(request),
    );
  });

  it('does not confuse values across fields', () => {
    // purpose "a" + comment null ≠ purpose null-like + comment "a".
    expect(
      hashCreateRequest({ ...request, purpose: 'a', comment: null }),
    ).not.toBe(
      hashCreateRequest({ ...request, purpose: 'null', comment: 'a' }),
    );
  });
});
