import { createHash } from 'crypto';
import { fieldBadRequest } from '../../common/validation/field-error';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
/** UUID підходить; також будь-який інший унікальний рядок з цих символів. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;
export const IDEMPOTENCY_KEY_FORMAT_MESSAGE =
  'Idempotency-Key має містити 8–128 символів: латинські літери, цифри, «-», «_», «.» або «:». Підходить UUID.';
export const IDEMPOTENCY_KEY_REUSED_MESSAGE =
  'Цей Idempotency-Key уже використано для оплати з іншими даними. Для нової оплати згенеруйте новий ключ.';

/**
 * Ключ із заголовка Idempotency-Key. Без заголовка (чи з порожнім) — null: запит
 * не ідемпотентний, як і раніше. Некоректний формат — 400.
 */
export function parseIdempotencyKey(value: string | undefined): string | null {
  const key = value?.trim();
  if (!key) {
    return null;
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw fieldBadRequest(
      IDEMPOTENCY_KEY_HEADER,
      IDEMPOTENCY_KEY_FORMAT_MESSAGE,
    );
  }
  return key;
}

/** Нормалізовані дані запиту створення: саме вони визначають «той самий запит». */
export type PaymentCreateFingerprint = {
  studentId: string;
  amount: string;
  currency: string;
  status: string;
  paidAt: string | null;
  purpose: string;
  comment: string | null;
};

/**
 * SHA-256 нормалізованого запиту. Ключі в фіксованому порядку, сума — рядком з двома
 * знаками, дата — ISO: 5000 і 5000.00 чи '2026-08-10' і '2026-08-10T00:00:00Z' — один запит.
 */
export function hashCreateRequest(request: PaymentCreateFingerprint): string {
  const normalized = [
    request.studentId,
    request.amount,
    request.currency,
    request.status,
    request.paidAt,
    request.purpose,
    request.comment,
  ];
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
