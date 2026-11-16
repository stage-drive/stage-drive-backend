import { PaymentStatus, Prisma } from '@prisma/client';
import {
  CurrentPaymentDto,
  PAYMENT_EDITABLE_FIELDS,
  PaymentChanges,
  PaymentDto,
  PaymentFieldChange,
  PaymentHistoryItemDto,
  PaymentRecordDto,
  PaymentStudentDto,
  PaymentTotalDto,
  StudentPaymentSummaryDto,
} from './payments.dto';

export const paymentPersonSelect = {
  id: true,
  firstName: true,
  lastName: true,
} satisfies Prisma.UserSelect;

export const paymentSelect = {
  id: true,
  organizationId: true,
  studentId: true,
  amount: true,
  currency: true,
  status: true,
  paidAt: true,
  purpose: true,
  comment: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: paymentPersonSelect },
} satisfies Prisma.PaymentSelect;

export type PaymentRow = Prisma.PaymentGetPayload<{
  select: typeof paymentSelect;
}>;

export const currentPaymentSelect = {
  id: true,
  amount: true,
  currency: true,
  status: true,
  paidAt: true,
  purpose: true,
} satisfies Prisma.PaymentSelect;

type CurrentPaymentRow = Prisma.PaymentGetPayload<{
  select: typeof currentPaymentSelect;
}>;

export const paymentHistorySelect = {
  id: true,
  paymentId: true,
  action: true,
  previousStatus: true,
  newStatus: true,
  changes: true,
  changedAt: true,
  comment: true,
  changedBy: { select: paymentPersonSelect },
  payment: { select: { studentId: true } },
} satisfies Prisma.PaymentHistorySelect;

export type PaymentHistoryRow = Prisma.PaymentHistoryGetPayload<{
  select: typeof paymentHistorySelect;
}>;

/** Студент у відповідях модуля: User + група з профілю. */
export const paymentStudentSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  organizationId: true,
  studentProfile: {
    select: {
      organizationId: true,
      group: { select: { id: true, name: true, organizationId: true } },
    },
  },
} satisfies Prisma.UserSelect;

export type PaymentStudentRow = Prisma.UserGetPayload<{
  select: typeof paymentStudentSelect;
}>;

/** Рядок плоского списку оплат: оплата + студент + чи вона зараз актуальна. */
export const paymentRecordSelect = {
  ...paymentSelect,
  student: {
    select: {
      ...paymentStudentSelect,
      studentProfile: {
        select: {
          ...paymentStudentSelect.studentProfile.select,
          currentPaymentId: true,
        },
      },
    },
  },
} satisfies Prisma.PaymentSelect;

export type PaymentRecordRow = Prisma.PaymentGetPayload<{
  select: typeof paymentRecordSelect;
}>;

export function formatAmount(amount: Prisma.Decimal): string {
  return amount.toFixed(2);
}

/** Актуальний статус студента: статус останньої оплати, без оплат — NOT_PAID. */
export function currentStatusOf(
  current: { status: PaymentStatus } | null | undefined,
): PaymentStatus {
  return current?.status ?? PaymentStatus.NOT_PAID;
}

export function toPaymentDto(
  row: PaymentRow,
  options: { includeComment: boolean } = { includeComment: true },
): PaymentDto {
  const dto: PaymentDto = {
    id: row.id,
    organizationId: row.organizationId,
    studentId: row.studentId,
    amount: formatAmount(row.amount),
    currency: row.currency,
    status: row.status,
    paidAt: row.paidAt,
    purpose: row.purpose,
    createdBy: {
      id: row.createdBy.id,
      firstName: row.createdBy.firstName,
      lastName: row.createdBy.lastName,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (options.includeComment) {
    dto.comment = row.comment;
  }
  return dto;
}

export function toCurrentPaymentDto(
  row: CurrentPaymentRow | null | undefined,
): CurrentPaymentDto | null {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    amount: formatAmount(row.amount),
    currency: row.currency,
    status: row.status,
    paidAt: row.paidAt,
    purpose: row.purpose,
  };
}

export function toPaymentStudentDto(row: PaymentStudentRow): PaymentStudentDto {
  const profile =
    row.studentProfile?.organizationId === row.organizationId
      ? row.studentProfile
      : null;
  const group =
    profile?.group && profile.group.organizationId === row.organizationId
      ? { id: profile.group.id, name: profile.group.name }
      : null;
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    group,
  };
}

export function toPaymentRecordDto(row: PaymentRecordRow): PaymentRecordDto {
  return {
    ...toPaymentDto(row),
    student: toPaymentStudentDto(row.student),
    isCurrent: row.student.studentProfile?.currentPaymentId === row.id,
  };
}

function isFieldChange(value: unknown): value is PaymentFieldChange {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { from, to } = value as Record<string, unknown>;
  return (
    (from === null || typeof from === 'string') &&
    (to === null || typeof to === 'string')
  );
}

/** Читає changes з JSONB. Невідомі ключі й зіпсовані значення відкидаються. */
export function parsePaymentChanges(
  value: Prisma.JsonValue,
): PaymentChanges | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const changes: PaymentChanges = {};
  for (const field of PAYMENT_EDITABLE_FIELDS) {
    const change = value[field];
    if (isFieldChange(change)) {
      changes[field] = { from: change.from, to: change.to };
    }
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

export function toPaymentHistoryItemDto(
  row: PaymentHistoryRow,
): PaymentHistoryItemDto {
  return {
    id: row.id,
    paymentId: row.paymentId,
    studentId: row.payment.studentId,
    action: row.action,
    previousStatus: row.previousStatus,
    newStatus: row.newStatus,
    changes: parsePaymentChanges(row.changes),
    changedBy: {
      id: row.changedBy.id,
      firstName: row.changedBy.firstName,
      lastName: row.changedBy.lastName,
    },
    changedAt: row.changedAt,
    comment: row.comment,
  };
}

/** Сума PAID-оплат окремо за валютою, у порядку коду валюти. */
export function paidTotals(
  payments: readonly Pick<PaymentRow, 'amount' | 'currency' | 'status'>[],
): PaymentTotalDto[] {
  const totals = new Map<string, Prisma.Decimal>();
  for (const payment of payments) {
    if (payment.status !== PaymentStatus.PAID) {
      continue;
    }
    const current = totals.get(payment.currency) ?? new Prisma.Decimal(0);
    totals.set(payment.currency, current.plus(payment.amount));
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amount]) => ({ currency, amount: formatAmount(amount) }));
}

/**
 * Оплати студента для картки, /students/:id/payments і /me/payments.
 * payments — усі оплати студента від нових до старих; currentPaymentId — Student.currentPaymentId.
 * Для STUDENT службовий коментар не повертається.
 */
export function toStudentPaymentSummary(
  payments: readonly PaymentRow[],
  currentPaymentId: string | null,
  options: { forStudent: boolean },
): StudentPaymentSummaryDto {
  const dtoOptions = { includeComment: !options.forStudent };
  const current =
    payments.find((payment) => payment.id === currentPaymentId) ?? null;
  return {
    status: currentStatusOf(current),
    currentPayment: current ? toPaymentDto(current, dtoOptions) : null,
    totalsPaid: paidTotals(payments),
    payments: payments.map((payment) => toPaymentDto(payment, dtoOptions)),
  };
}
