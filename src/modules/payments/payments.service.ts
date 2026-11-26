import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  PaymentHistoryAction,
  PaymentStatus,
  Prisma,
  TrainingStatus,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import {
  lockScheduleResources,
  scheduleLockKey,
} from '../../common/prisma/schedule-lock';
import { isUniqueConstraintOn } from '../../common/prisma/unique-constraint';
import { searchConditions } from '../../common/prisma/user-search';
import { localDate } from '../../common/time/zoned-time';
import { fieldBadRequest } from '../../common/validation/field-error';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  IDEMPOTENCY_KEY_REUSED_MESSAGE,
  hashCreateRequest,
  parseIdempotencyKey,
} from './payment-idempotency';
import { PAYMENT_MANAGE_ROLES, PAYMENT_SELF_ROLES } from './payment-roles';
import {
  currentPaymentSelect,
  currentStatusOf,
  formatAmount,
  PaymentRow,
  paymentHistorySelect,
  paymentRecordSelect,
  paymentSelect,
  paymentStudentSelect,
  toCurrentPaymentDto,
  toPaymentDto,
  toPaymentHistoryItemDto,
  toPaymentRecordDto,
  toPaymentStudentDto,
  toStudentPaymentSummary,
} from './payment-view';
import {
  CreatePaymentDto,
  DEFAULT_CURRENCY,
  ListPaymentRecordsQueryDto,
  ListPaymentsQueryDto,
  PaymentChanges,
  PaymentDetailsDto,
  PaymentDto,
  PAYMENT_EDITABLE_FIELDS,
  PaymentEditableField,
  PaymentHistoryListDto,
  PaymentHistoryQueryDto,
  PaymentOverviewListDto,
  PaymentRecordListDto,
  PaymentRecordSortField,
  PaymentSortField,
  PaymentSortOrder,
  StudentPaymentSummaryDto,
  UpdatePaymentDto,
  UpdatePaymentStatusDto,
} from './payments.dto';

export { PAYMENT_MANAGE_ROLES, PAYMENT_SELF_ROLES };

export const PAYMENT_NOT_FOUND_MESSAGE = 'Payment not found';
export const PAYMENT_STUDENT_NOT_FOUND_MESSAGE = 'Student not found';
export const STUDENT_ARCHIVED_MESSAGE =
  'Не можна додати оплату архівованому студенту.';
export const PAYMENT_FINAL_STATUS_MESSAGE =
  'Оплата вже має фінальний статус PAID.';
export const PAYMENT_STATUS_UNCHANGED_MESSAGE = 'Оплата вже має цей статус.';
export const PAID_AT_REQUIRED_MESSAGE =
  'Для статусу PAID вкажіть paidAt — дату оплати.';
export const PAID_AT_FORBIDDEN_MESSAGE =
  'Для статусу NOT_PAID дата оплати не вказується.';
export const PAID_AMOUNT_POSITIVE_MESSAGE =
  'Сума підтвердженої оплати має бути більшою за 0.';
export const PAID_AT_FUTURE_MESSAGE = 'Дата оплати не може бути в майбутньому.';
export const PAID_AT_TOO_EARLY_MESSAGE =
  'Дата оплати не може бути раніше 01.01.2000.';
export const NO_PAYMENT_FIELDS_MESSAGE =
  'Немає полів для оновлення (amount, currency, paidAt, purpose, comment).';
export const HISTORY_RANGE_MESSAGE = 'to має бути пізніше за from.';
export const PAID_RANGE_MESSAGE = 'paidTo має бути пізніше за paidFrom.';
export { IDEMPOTENCY_KEY_REUSED_MESSAGE };

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const DEFAULT_SORT_BY: PaymentSortField = 'lastName';
const DEFAULT_SORT_ORDER: PaymentSortOrder = 'asc';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const PAID_AT_MIN = new Date('2000-01-01T00:00:00.000Z');

const paymentOrder: Prisma.PaymentOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'desc' },
];
const historyOrder: Prisma.PaymentHistoryOrderByWithRelationInput[] = [
  { changedAt: 'desc' },
  { id: 'desc' },
];

const overviewSelect = {
  id: true,
  organizationId: true,
  // Складений FK гарантує, що це оплата саме цього студента.
  currentPayment: { select: currentPaymentSelect },
  user: { select: paymentStudentSelect },
} satisfies Prisma.StudentSelect;

/** Стан оплати, який перевіряють бізнес-правила 10–12. */
type PaymentState = {
  status: PaymentStatus;
  amount: Prisma.Decimal;
  currency: string;
  paidAt: Date | null;
  purpose: string;
  comment: string | null;
};

function toDecimal(amount: number): Prisma.Decimal {
  // String(), а не число: Decimal не успадковує двійкову похибку float.
  return new Prisma.Decimal(String(amount));
}

function pagination(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}

function overviewStatusFilter(
  status: PaymentStatus | undefined,
): Prisma.StudentWhereInput | null {
  switch (status) {
    case PaymentStatus.PAID:
      return { currentPayment: { is: { status: PaymentStatus.PAID } } };
    case PaymentStatus.NOT_PAID:
      // Студент без жодної оплати теж NOT_PAID.
      return {
        OR: [
          { currentPaymentId: null },
          { currentPayment: { is: { status: PaymentStatus.NOT_PAID } } },
        ],
      };
    default:
      return null;
  }
}

function overviewOrderBy(
  sortBy: PaymentSortField,
  sortOrder: PaymentSortOrder,
): Prisma.StudentOrderByWithRelationInput[] {
  const tieBreak: Prisma.StudentOrderByWithRelationInput = { id: 'asc' };
  switch (sortBy) {
    case 'lastName':
      return [
        { user: { lastName: sortOrder } },
        { user: { firstName: sortOrder } },
        tieBreak,
      ];
    case 'firstName':
      return [
        { user: { firstName: sortOrder } },
        { user: { lastName: sortOrder } },
        tieBreak,
      ];
    case 'paidAt':
      return [
        { currentPayment: { paidAt: { sort: sortOrder, nulls: 'last' } } },
        { user: { lastName: 'asc' } },
        tieBreak,
      ];
    case 'createdAt':
      return [{ createdAt: sortOrder }, tieBreak];
  }
}

function recordsOrderBy(
  sortBy: PaymentRecordSortField,
  sortOrder: PaymentSortOrder,
): Prisma.PaymentOrderByWithRelationInput[] {
  switch (sortBy) {
    case 'createdAt':
      return [{ createdAt: sortOrder }, { id: sortOrder }];
    case 'paidAt':
      return [{ paidAt: { sort: sortOrder, nulls: 'last' } }, ...paymentOrder];
    case 'amount':
      return [{ amount: sortOrder }, ...paymentOrder];
  }
}

/**
 * paidAt — день оплати. «У майбутньому» рахується за календарем автошколи
 * (Organization.timezone), а не UTC: о 00:30 за Києвом '2026-11-15' — це вже
 * сьогодні, хоча в UTC ще 14-те. Дата без часу порівнюється як дата.
 */
function parsePaidAt(value: string, now: Date, timeZone: string): Date {
  const paidAt = new Date(value);
  const paidDay = DATE_ONLY.test(value) ? value : localDate(paidAt, timeZone);
  if (paidDay > localDate(now, timeZone)) {
    throw fieldBadRequest('paidAt', PAID_AT_FUTURE_MESSAGE);
  }
  if (paidAt.getTime() < PAID_AT_MIN.getTime()) {
    throw fieldBadRequest('paidAt', PAID_AT_TOO_EARLY_MESSAGE);
  }
  return paidAt;
}

/** Бізнес-правила 10–12: paidAt лише для PAID, а PAID має суму > 0. */
function assertPaymentState(state: PaymentState): void {
  if (state.status === PaymentStatus.PAID) {
    if (!state.paidAt) {
      throw fieldBadRequest('paidAt', PAID_AT_REQUIRED_MESSAGE);
    }
    if (state.amount.lessThanOrEqualTo(0)) {
      throw fieldBadRequest('amount', PAID_AMOUNT_POSITIVE_MESSAGE);
    }
  } else if (state.paidAt) {
    throw fieldBadRequest('paidAt', PAID_AT_FORBIDDEN_MESSAGE);
  }
}

function formatField(
  field: PaymentEditableField,
  state: PaymentState,
): string | null {
  switch (field) {
    case 'amount':
      return formatAmount(state.amount);
    case 'currency':
      return state.currency;
    case 'paidAt':
      return state.paidAt ? state.paidAt.toISOString() : null;
    case 'purpose':
      return state.purpose;
    case 'comment':
      return state.comment;
  }
}

function diffPaymentState(
  before: PaymentState,
  after: PaymentState,
): PaymentChanges {
  const changes: PaymentChanges = {};
  for (const field of PAYMENT_EDITABLE_FIELDS) {
    const from = formatField(field, before);
    const to = formatField(field, after);
    if (from !== to) {
      changes[field] = { from, to };
    }
  }
  return changes;
}

function isEmptyUpdate(payload: UpdatePaymentDto): boolean {
  return (
    payload.amount === undefined &&
    payload.currency === undefined &&
    payload.paidAt === undefined &&
    payload.purpose === undefined &&
    payload.comment === undefined
  );
}

/**
 * Модуль 13. Оплати. Записи про оплату ведуть OWNER і ADMIN своєї автошколи,
 * STUDENT лише читає власні. organizationId завжди береться з авторизованого
 * користувача. Оплати та журнал не видаляються.
 *
 * Кожен запис бере блокування студента (scheduleLockKey('student', id)) — те саме,
 * яке тримає бронювання практики. Тому перевірка оплати під час бронювання і зміна
 * оплати не перетинаються.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /** UC-001: студенти автошколи з актуальним статусом і останньою оплатою. */
  async overview(
    actor: User,
    query: ListPaymentsQueryDto,
  ): Promise<PaymentOverviewListDto> {
    this.assertRole(actor, PAYMENT_MANAGE_ROLES, 'overview');
    await this.requireOrganization(actor.organizationId);

    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const filters: Prisma.StudentWhereInput[] = [
      {
        organizationId: actor.organizationId,
        user: {
          organizationId: actor.organizationId,
          role: UserRole.STUDENT,
          deletedAt: null,
        },
      },
    ];
    if (query.search) {
      filters.push({ user: { OR: searchConditions(query.search) } });
    }
    if (query.groupId) {
      filters.push({ groupId: query.groupId });
    }
    const statusFilter = overviewStatusFilter(query.status);
    if (statusFilter) {
      filters.push(statusFilter);
    }
    const where: Prisma.StudentWhereInput = { AND: filters };

    const [rows, total] = await Promise.all([
      this.prisma.student.findMany({
        where,
        select: overviewSelect,
        orderBy: overviewOrderBy(
          query.sortBy ?? DEFAULT_SORT_BY,
          query.sortOrder ?? DEFAULT_SORT_ORDER,
        ),
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.student.count({ where }),
    ]);

    return {
      students: rows.map((row) => {
        const current = row.currentPayment;
        return {
          student: toPaymentStudentDto(row.user),
          status: currentStatusOf(current),
          currentPayment: toCurrentPaymentDto(current),
        };
      }),
      pagination: pagination(page, limit, total),
    };
  }

  /**
   * Плоский список записів оплат автошколи з фільтрами за студентом, статусом запису,
   * групою, пошуком студента і датою оплати. Кожен рядок — оплата разом зі студентом.
   */
  async records(
    actor: User,
    query: ListPaymentRecordsQueryDto,
  ): Promise<PaymentRecordListDto> {
    this.assertRole(actor, PAYMENT_MANAGE_ROLES, 'records');
    await this.requireOrganization(actor.organizationId);

    const paidFrom = query.paidFrom ? new Date(query.paidFrom) : undefined;
    const paidTo = query.paidTo ? new Date(query.paidTo) : undefined;
    if (paidFrom && paidTo && paidFrom.getTime() >= paidTo.getTime()) {
      throw fieldBadRequest('paidTo', PAID_RANGE_MESSAGE);
    }

    const studentFilters: Prisma.UserWhereInput[] = [];
    if (query.groupId) {
      studentFilters.push({
        studentProfile: {
          is: { organizationId: actor.organizationId, groupId: query.groupId },
        },
      });
    }
    if (query.search) {
      studentFilters.push({ OR: searchConditions(query.search) });
    }
    const where: Prisma.PaymentWhereInput = {
      organizationId: actor.organizationId,
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(studentFilters.length > 0
        ? { student: { AND: studentFilters } }
        : {}),
      ...(paidFrom || paidTo
        ? {
            paidAt: {
              ...(paidFrom ? { gte: paidFrom } : {}),
              ...(paidTo ? { lt: paidTo } : {}),
            },
          }
        : {}),
    };

    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        select: paymentRecordSelect,
        orderBy: recordsOrderBy(
          query.sortBy ?? 'createdAt',
          query.sortOrder ?? 'desc',
        ),
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      payments: rows.map(toPaymentRecordDto),
      pagination: pagination(page, limit, total),
    };
  }

  /** Журнал змін оплат автошколи, від нових подій до старих. */
  async history(
    actor: User,
    query: PaymentHistoryQueryDto,
  ): Promise<PaymentHistoryListDto> {
    this.assertRole(actor, PAYMENT_MANAGE_ROLES, 'history');
    await this.requireOrganization(actor.organizationId);

    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from.getTime() >= to.getTime()) {
      throw fieldBadRequest('to', HISTORY_RANGE_MESSAGE);
    }

    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const where: Prisma.PaymentHistoryWhereInput = {
      organizationId: actor.organizationId,
      ...(query.paymentId ? { paymentId: query.paymentId } : {}),
      ...(query.studentId ? { payment: { studentId: query.studentId } } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(from || to
        ? {
            changedAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lt: to } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.paymentHistory.findMany({
        where,
        select: paymentHistorySelect,
        orderBy: historyOrder,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.paymentHistory.count({ where }),
    ]);

    return {
      history: rows.map(toPaymentHistoryItemDto),
      pagination: pagination(page, limit, total),
    };
  }

  async getById(actor: User, paymentId: string): Promise<PaymentDetailsDto> {
    this.assertRole(actor, PAYMENT_MANAGE_ROLES, 'getById');
    await this.requireOrganization(actor.organizationId);

    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, organizationId: actor.organizationId },
      select: {
        ...paymentSelect,
        student: { select: paymentStudentSelect },
        history: { select: paymentHistorySelect, orderBy: historyOrder },
      },
    });
    if (!payment) {
      throw this.paymentNotFound(actor, paymentId);
    }

    return {
      ...toPaymentDto(payment),
      student: toPaymentStudentDto(payment.student),
      history: payment.history.map(toPaymentHistoryItemDto),
    };
  }

  /**
   * UC-002. Нова оплата стає останньою, тож її статус — актуальний статус студента.
   *
   * idempotencyKeyHeader — заголовок Idempotency-Key. Повтор запиту з тим самим ключем
   * і тими самими даними повертає вже створену оплату без нового запису (подвійний клік,
   * повтор після обриву мережі). Той самий ключ з іншими даними — 409.
   */
  async create(
    actor: User,
    payload: CreatePaymentDto,
    idempotencyKeyHeader?: string,
  ): Promise<PaymentDto> {
    this.assertRole(actor, PAYMENT_MANAGE_ROLES, 'create');
    const idempotencyKey = parseIdempotencyKey(idempotencyKeyHeader);
    const { timezone } = await this.requireOrganization(actor.organizationId);

    const now = new Date();
    const state: PaymentState = {
      status: payload.status ?? PaymentStatus.PAID,
      amount: toDecimal(payload.amount),
      currency: payload.currency ?? DEFAULT_CURRENCY,
      paidAt: payload.paidAt
        ? parsePaidAt(payload.paidAt, now, timezone)
        : null,
      purpose: payload.purpose,
      comment: payload.comment ?? null,
    };
    assertPaymentState(state);
    const idempotency = idempotencyKey
      ? {
          key: idempotencyKey,
          hash: hashCreateRequest({
            studentId: payload.studentId,
            amount: formatAmount(state.amount),
            currency: state.currency,
            status: state.status,
            paidAt: state.paidAt ? state.paidAt.toISOString() : null,
            purpose: state.purpose,
            comment: state.comment,
          }),
        }
      : null;

    let result: { payment: PaymentRow; replayed: boolean };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        await this.lockStudent(tx, payload.studentId);
        if (idempotency) {
          const replay = await this.findIdempotentPayment(
            tx,
            actor,
            idempotency,
          );
          if (replay) {
            return { payment: replay, replayed: true };
          }
        }
        const payment = await this.insertPayment(
          tx,
          actor,
          payload.studentId,
          state,
          idempotency,
        );
        return { payment, replayed: false };
      });
    } catch (error) {
      // Той самий ключ паралельно для іншого студента: блокування різні, тож першим
      // встиг інший запит, а цей упав на унікальному індексі. Відповідаємо як на повтор.
      if (!idempotency || !isUniqueConstraintOn(error, 'idempotencyKey')) {
        throw error;
      }
      const replay = await this.findIdempotentPayment(
        this.prisma,
        actor,
        idempotency,
      );
      if (!replay) {
        throw error;
      }
      result = { payment: replay, replayed: true };
    }

    const saved = result.payment;
    if (result.replayed) {
      this.logger.log(
        `Payment create replayed paymentId=${saved.id} studentId=${saved.studentId} actorId=${actor.id} organizationId=${actor.organizationId}`,
      );
    } else {
      this.logger.log(
        `Payment created paymentId=${saved.id} studentId=${saved.studentId} status=${saved.status} amount=${formatAmount(saved.amount)} currency=${saved.currency} actorId=${actor.id} organizationId=${actor.organizationId}`,
      );
      await this.notifications?.emit({
        kind: 'payment.recorded',
        organizationId: actor.organizationId,
        actorId: actor.id,
        paymentId: saved.id,
        studentId: saved.studentId,
        status: saved.status,
        purpose: saved.purpose,
        amount: formatAmount(saved.amount),
        currency: saved.currency,
      });
    }
    return toPaymentDto(saved);
  }

  /** Новий запис оплати, подія CREATED і новий вказівник на актуальну оплату. */
  private async insertPayment(
    tx: Prisma.TransactionClient,
    actor: User,
    studentId: string,
    state: PaymentState,
    idempotency: { key: string; hash: string } | null,
  ): Promise<PaymentRow> {
    const profileId = await this.requirePayableStudent(tx, actor, studentId);

    const payment = await tx.payment.create({
      data: {
        organizationId: actor.organizationId,
        studentId,
        amount: state.amount,
        currency: state.currency,
        status: state.status,
        paidAt: state.paidAt,
        purpose: state.purpose,
        comment: state.comment,
        createdById: actor.id,
        idempotencyKey: idempotency?.key ?? null,
        requestHash: idempotency?.hash ?? null,
      },
      select: paymentSelect,
    });
    await tx.paymentHistory.create({
      data: {
        organizationId: actor.organizationId,
        paymentId: payment.id,
        action: PaymentHistoryAction.CREATED,
        previousStatus: null,
        newStatus: payment.status,
        changedById: actor.id,
      },
    });
    await tx.student.update({
      where: { id: profileId },
      data: { currentPaymentId: payment.id },
    });
    return payment;
  }

  /**
   * Оплата, вже створена з цим ключем в автошколі. Інші дані під тим самим ключем — 409:
   * це не повтор, а помилка клієнта, і мовчки повертати чужий результат не можна.
   */
  private async findIdempotentPayment(
    tx: Prisma.TransactionClient,
    actor: User,
    idempotency: { key: string; hash: string },
  ): Promise<PaymentRow | null> {
    const existing = await tx.payment.findFirst({
      where: {
        organizationId: actor.organizationId,
        idempotencyKey: idempotency.key,
      },
      select: { ...paymentSelect, requestHash: true },
    });
    if (!existing) {
      return null;
    }
    if (existing.requestHash !== idempotency.hash) {
      this.logger.warn(
        `Payment idempotency key reused with other data paymentId=${existing.id} actorId=${actor.id} organizationId=${actor.organizationId}`,
      );
      throw new ConflictException(IDEMPOTENCY_KEY_REUSED_MESSAGE);
    }
    return existing;
  }

  /** Сума, валюта, дата оплати й коментар. Статус змінюється лише через changeStatus. */
  async update(
    actor: User,
    paymentId: string,
    payload: UpdatePaymentDto,
  ): Promise<PaymentDto> {
    this.assertRole(actor, PAYMENT_MANAGE_ROLES, 'update');
    if (isEmptyUpdate(payload)) {
      throw fieldBadRequest('body', NO_PAYMENT_FIELDS_MESSAGE);
    }
    const { timezone } = await this.requireOrganization(actor.organizationId);
    const now = new Date();
    const paidAt =
      payload.paidAt !== undefined
        ? parsePaidAt(payload.paidAt, now, timezone)
        : null;

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await this.lockPayment(tx, actor, paymentId);
      const before: PaymentState = {
        status: existing.status,
        amount: existing.amount,
        currency: existing.currency,
        paidAt: existing.paidAt,
        purpose: existing.purpose,
        comment: existing.comment,
      };
      if (paidAt && existing.status !== PaymentStatus.PAID) {
        throw fieldBadRequest('paidAt', PAID_AT_FORBIDDEN_MESSAGE);
      }
      const after: PaymentState = {
        status: existing.status,
        amount:
          payload.amount !== undefined
            ? toDecimal(payload.amount)
            : existing.amount,
        currency: payload.currency ?? existing.currency,
        paidAt: paidAt ?? existing.paidAt,
        purpose: payload.purpose ?? existing.purpose,
        comment:
          payload.comment !== undefined ? payload.comment : existing.comment,
      };
      assertPaymentState(after);

      const changes = diffPaymentState(before, after);
      if (Object.keys(changes).length === 0) {
        return { payment: existing, changes };
      }

      const payment = await tx.payment.update({
        where: { id: existing.id },
        data: {
          amount: after.amount,
          currency: after.currency,
          paidAt: after.paidAt,
          purpose: after.purpose,
          comment: after.comment,
        },
        select: paymentSelect,
      });
      await tx.paymentHistory.create({
        data: {
          organizationId: actor.organizationId,
          paymentId: payment.id,
          action: PaymentHistoryAction.UPDATED,
          previousStatus: existing.status,
          newStatus: existing.status,
          changes,
          changedById: actor.id,
        },
      });
      return { payment, changes };
    });

    const fields = Object.keys(result.changes);
    if (fields.length > 0) {
      this.logger.log(
        `Payment updated paymentId=${paymentId} studentId=${result.payment.studentId} fields=${fields.join(',')} actorId=${actor.id} organizationId=${actor.organizationId}`,
      );
    }
    return toPaymentDto(result.payment);
  }

  /** UC-003. У MVP лише NOT_PAID → PAID: PAID фінальний. */
  async changeStatus(
    actor: User,
    paymentId: string,
    payload: UpdatePaymentStatusDto,
  ): Promise<PaymentDto> {
    this.assertRole(actor, PAYMENT_MANAGE_ROLES, 'changeStatus');
    const { timezone } = await this.requireOrganization(actor.organizationId);
    const now = new Date();
    const paidAt = payload.paidAt
      ? parsePaidAt(payload.paidAt, now, timezone)
      : now;

    const saved = await this.prisma.$transaction(async (tx) => {
      const existing = await this.lockPayment(tx, actor, paymentId);
      if (existing.status === PaymentStatus.PAID) {
        throw new ConflictException(PAYMENT_FINAL_STATUS_MESSAGE);
      }
      if (payload.status === existing.status) {
        throw new ConflictException(PAYMENT_STATUS_UNCHANGED_MESSAGE);
      }
      if (existing.amount.lessThanOrEqualTo(0)) {
        throw new ConflictException(PAID_AMOUNT_POSITIVE_MESSAGE);
      }

      const payment = await tx.payment.update({
        where: { id: existing.id },
        data: { status: payload.status, paidAt },
        select: paymentSelect,
      });
      await tx.paymentHistory.create({
        data: {
          organizationId: actor.organizationId,
          paymentId: payment.id,
          action: PaymentHistoryAction.STATUS_CHANGED,
          previousStatus: existing.status,
          newStatus: payment.status,
          changedById: actor.id,
          comment: payload.comment ?? null,
        },
      });
      return { payment, previousStatus: existing.status };
    });

    this.logger.log(
      `Payment status changed paymentId=${paymentId} studentId=${saved.payment.studentId} previousStatus=${saved.previousStatus} newStatus=${saved.payment.status} actorId=${actor.id} organizationId=${actor.organizationId}`,
    );
    await this.notifications?.emit({
      kind: 'payment.status_changed',
      organizationId: actor.organizationId,
      actorId: actor.id,
      paymentId: saved.payment.id,
      studentId: saved.payment.studentId,
      status: saved.payment.status,
      purpose: saved.payment.purpose,
      amount: formatAmount(saved.payment.amount),
      currency: saved.payment.currency,
    });
    return toPaymentDto(saved.payment);
  }

  /** UC-006: оплати студента своєї автошколи. studentId — id користувача. */
  async forStudent(
    actor: User,
    studentId: string,
  ): Promise<StudentPaymentSummaryDto> {
    this.assertRole(actor, PAYMENT_MANAGE_ROLES, 'forStudent');
    await this.requireOrganization(actor.organizationId);
    return this.summary(actor, studentId, { forStudent: false });
  }

  /** UC-004: власні оплати студента. */
  async own(actor: User): Promise<StudentPaymentSummaryDto> {
    this.assertRole(actor, PAYMENT_SELF_ROLES, 'own');
    await this.requireOrganization(actor.organizationId);
    return this.summary(actor, actor.id, { forStudent: true });
  }

  private async summary(
    actor: User,
    studentId: string,
    options: { forStudent: boolean },
  ): Promise<StudentPaymentSummaryDto> {
    const student = await this.prisma.user.findFirst({
      where: {
        id: studentId,
        organizationId: actor.organizationId,
        role: UserRole.STUDENT,
        deletedAt: null,
        studentProfile: { is: { organizationId: actor.organizationId } },
      },
      select: {
        studentProfile: { select: { currentPaymentId: true } },
        studentPayments: {
          where: { organizationId: actor.organizationId },
          select: paymentSelect,
          orderBy: paymentOrder,
        },
      },
    });
    if (!student) {
      this.logger.warn(
        `Payment access denied reason=student_not_found studentId=${studentId} actorId=${actor.id} role=${actor.role} organizationId=${actor.organizationId}`,
      );
      throw new NotFoundException(PAYMENT_STUDENT_NOT_FOUND_MESSAGE);
    }
    return toStudentPaymentSummary(
      student.studentPayments,
      student.studentProfile?.currentPaymentId ?? null,
      options,
    );
  }

  private assertRole(
    actor: User,
    roles: readonly UserRole[],
    operation: string,
  ): void {
    if (!roles.includes(actor.role)) {
      this.logger.warn(
        `Payment access denied reason=role operation=${operation} actorId=${actor.id} role=${actor.role} organizationId=${actor.organizationId}`,
      );
      throw new ForbiddenException('Insufficient permissions');
    }
  }

  private paymentNotFound(actor: User, paymentId: string): NotFoundException {
    // Оплата іншої автошколи виглядає так само, як неіснуюча: 404 без подробиць.
    this.logger.warn(
      `Payment access denied reason=not_found paymentId=${paymentId} actorId=${actor.id} role=${actor.role} organizationId=${actor.organizationId}`,
    );
    return new NotFoundException(PAYMENT_NOT_FOUND_MESSAGE);
  }

  private lockStudent(
    tx: Prisma.TransactionClient,
    studentId: string,
  ): Promise<void> {
    return lockScheduleResources(tx, [scheduleLockKey('student', studentId)]);
  }

  /** Блокує студента оплати і перечитує оплату вже під блокуванням. */
  private async lockPayment(
    tx: Prisma.TransactionClient,
    actor: User,
    paymentId: string,
  ) {
    const where = { id: paymentId, organizationId: actor.organizationId };
    const owner = await tx.payment.findFirst({
      where,
      select: { studentId: true },
    });
    if (!owner) {
      throw this.paymentNotFound(actor, paymentId);
    }
    await this.lockStudent(tx, owner.studentId);
    const payment = await tx.payment.findFirst({
      where,
      select: paymentSelect,
    });
    if (!payment) {
      throw this.paymentNotFound(actor, paymentId);
    }
    return payment;
  }

  /** Студент своєї автошколи, якому можна додати оплату. Повертає id профілю. */
  private async requirePayableStudent(
    tx: Prisma.TransactionClient,
    actor: User,
    studentId: string,
  ): Promise<string> {
    const student = await tx.user.findFirst({
      where: {
        id: studentId,
        organizationId: actor.organizationId,
        role: UserRole.STUDENT,
        deletedAt: null,
        studentProfile: { is: { organizationId: actor.organizationId } },
      },
      select: {
        status: true,
        studentProfile: { select: { id: true, trainingStatus: true } },
      },
    });
    const profile = student?.studentProfile;
    if (!student || !profile) {
      this.logger.warn(
        `Payment access denied reason=student_not_found studentId=${studentId} actorId=${actor.id} role=${actor.role} organizationId=${actor.organizationId}`,
      );
      throw new NotFoundException(PAYMENT_STUDENT_NOT_FOUND_MESSAGE);
    }
    if (
      student.status === UserStatus.ARCHIVED ||
      profile.trainingStatus === TrainingStatus.ARCHIVED
    ) {
      throw new ConflictException(STUDENT_ARCHIVED_MESSAGE);
    }
    return profile.id;
  }

  /** Автошкола користувача; timezone — її календар для перевірки paidAt. */
  private async requireOrganization(
    organizationId: string,
  ): Promise<{ timezone: string }> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { deletedAt: true, timezone: true },
    });
    if (!organization || organization.deletedAt) {
      throw new NotFoundException('Organization not found');
    }
    return { timezone: organization.timezone };
  }
}
