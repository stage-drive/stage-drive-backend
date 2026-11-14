import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
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
import { PrismaService } from '../../prisma/prisma.service';
import {
  IDEMPOTENCY_KEY_FORMAT_MESSAGE,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_KEY_REUSED_MESSAGE,
} from './payment-idempotency';
import {
  HISTORY_RANGE_MESSAGE,
  NO_PAYMENT_FIELDS_MESSAGE,
  PAID_AMOUNT_POSITIVE_MESSAGE,
  PAID_AT_FORBIDDEN_MESSAGE,
  PAID_AT_FUTURE_MESSAGE,
  PAID_AT_REQUIRED_MESSAGE,
  PAID_AT_TOO_EARLY_MESSAGE,
  PAYMENT_FINAL_STATUS_MESSAGE,
  PAYMENT_NOT_FOUND_MESSAGE,
  PAYMENT_STATUS_UNCHANGED_MESSAGE,
  PAYMENT_STUDENT_NOT_FOUND_MESSAGE,
  PAID_RANGE_MESSAGE,
  PaymentsService,
  STUDENT_ARCHIVED_MESSAGE,
} from './payments.service';

const STUDENT_ID = '88888888-8888-4888-8888-888888888888';
const PAYMENT_ID = '44444444-4444-4444-8444-444444444444';

function actor(role: UserRole, organizationId = 'org-1'): User {
  return {
    id: `${role.toLowerCase()}-1`,
    role,
    organizationId,
  } as User;
}

function paymentRow(
  overrides: Partial<{
    id: string;
    organizationId: string;
    studentId: string;
    status: PaymentStatus;
    amount: Prisma.Decimal;
    currency: string;
    paidAt: Date | null;
    comment: string | null;
  }> = {},
) {
  return {
    id: PAYMENT_ID,
    organizationId: 'org-1',
    studentId: STUDENT_ID,
    amount: new Prisma.Decimal('5000'),
    currency: 'UAH',
    status: PaymentStatus.PAID as PaymentStatus,
    paidAt: new Date('2026-08-10T00:00:00.000Z'),
    purpose: 'Курс теорії',
    comment: 'Готівка' as string | null,
    createdAt: new Date('2026-08-10T09:00:00.000Z'),
    updatedAt: new Date('2026-08-10T09:00:00.000Z'),
    createdBy: { id: 'admin-1', firstName: 'Ірина', lastName: 'Адміненко' },
    ...overrides,
  };
}

function notPaidRow(
  overrides: Parameters<typeof paymentRow>[0] = {},
): ReturnType<typeof paymentRow> {
  return paymentRow({
    status: PaymentStatus.NOT_PAID,
    paidAt: null,
    comment: null,
    ...overrides,
  });
}

function studentUserRow(
  overrides: Partial<{
    status: UserStatus;
    trainingStatus: TrainingStatus;
  }> = {},
) {
  return {
    status: overrides.status ?? UserStatus.ACTIVE,
    studentProfile: {
      id: 'profile-1',
      trainingStatus: overrides.trainingStatus ?? TrainingStatus.PRACTICE,
    },
  };
}

function paymentStudent() {
  return {
    id: STUDENT_ID,
    firstName: 'Олена',
    lastName: 'Коваль',
    email: 'student@example.com',
    organizationId: 'org-1',
    studentProfile: {
      organizationId: 'org-1',
      group: { id: 'group-1', name: 'Група B-12', organizationId: 'org-1' },
    },
  };
}

function historyRow(
  overrides: Partial<{
    action: PaymentHistoryAction;
    previousStatus: PaymentStatus | null;
    newStatus: PaymentStatus;
    changes: Prisma.JsonValue;
    comment: string | null;
  }> = {},
) {
  return {
    id: 'history-1',
    paymentId: PAYMENT_ID,
    action: PaymentHistoryAction.CREATED as PaymentHistoryAction,
    previousStatus: null as PaymentStatus | null,
    newStatus: PaymentStatus.PAID as PaymentStatus,
    changes: null as Prisma.JsonValue,
    changedAt: new Date('2026-08-10T09:00:00.000Z'),
    comment: null as string | null,
    changedBy: { id: 'admin-1', firstName: 'Ірина', lastName: 'Адміненко' },
    payment: { studentId: STUDENT_ID },
    ...overrides,
  };
}

describe('PaymentsService', () => {
  const prisma = {
    organization: { findUnique: jest.fn() },
    student: {
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    user: { findFirst: jest.fn() },
    payment: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    paymentHistory: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  };

  let service: PaymentsService;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.organization.findUnique.mockResolvedValue({
      deletedAt: null,
      timezone: 'Europe/Kyiv',
    });
    prisma.student.findMany.mockResolvedValue([]);
    prisma.student.count.mockResolvedValue(0);
    prisma.paymentHistory.findMany.mockResolvedValue([]);
    prisma.payment.findMany.mockResolvedValue([]);
    prisma.payment.count.mockResolvedValue(0);
    prisma.paymentHistory.count.mockResolvedValue(0);
    prisma.$executeRaw.mockResolvedValue(0);
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    service = new PaymentsService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  function expectStudentLock(studentId: string) {
    expect(prisma.$executeRaw).toHaveBeenCalledWith(
      expect.anything(),
      `student:${studentId}`,
    );
  }

  describe('RBAC', () => {
    const manage = [
      (user: User) => service.overview(user, {}),
      (user: User) => service.history(user, {}),
      (user: User) => service.records(user, {}),
      (user: User) => service.getById(user, PAYMENT_ID),
      (user: User) =>
        service.create(user, {
          purpose: 'Курс теорії',
          studentId: STUDENT_ID,
          amount: 1,
        }),
      (user: User) => service.update(user, PAYMENT_ID, { amount: 1 }),
      (user: User) =>
        service.changeStatus(user, PAYMENT_ID, { status: PaymentStatus.PAID }),
      (user: User) => service.forStudent(user, STUDENT_ID),
    ];

    it.each([UserRole.TEACHER, UserRole.INSTRUCTOR, UserRole.STUDENT])(
      'rejects %s on every management operation before touching the database',
      async (role) => {
        for (const call of manage) {
          await expect(call(actor(role))).rejects.toBeInstanceOf(
            ForbiddenException,
          );
        }
        expect(prisma.organization.findUnique).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Payment access denied reason=role'),
        );
      },
    );

    it.each([UserRole.OWNER, UserRole.ADMIN, UserRole.TEACHER])(
      'lets only STUDENT read own payments, not %s',
      async (role) => {
        await expect(service.own(actor(role))).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      },
    );

    it('returns 404 when the organization is deleted', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        deletedAt: new Date(),
      });

      await expect(
        service.overview(actor(UserRole.ADMIN), {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('overview', () => {
    it.each([UserRole.OWNER, UserRole.ADMIN])(
      'lists students of the %s organization with default sort and pagination',
      async (role) => {
        prisma.student.findMany.mockResolvedValue([
          {
            id: 'profile-1',
            organizationId: 'org-1',
            currentPayment: {
              id: PAYMENT_ID,
              amount: new Prisma.Decimal('5000'),
              currency: 'UAH',
              status: PaymentStatus.PAID,
              paidAt: new Date('2026-08-10T00:00:00.000Z'),
            },
            user: paymentStudent(),
          },
          {
            id: 'profile-2',
            organizationId: 'org-1',
            currentPayment: null,
            user: {
              ...paymentStudent(),
              id: 'student-2',
              studentProfile: null,
            },
          },
        ]);
        prisma.student.count.mockResolvedValue(2);

        await expect(service.overview(actor(role), {})).resolves.toEqual({
          students: [
            {
              student: {
                id: STUDENT_ID,
                firstName: 'Олена',
                lastName: 'Коваль',
                email: 'student@example.com',
                group: { id: 'group-1', name: 'Група B-12' },
              },
              status: PaymentStatus.PAID,
              currentPayment: {
                id: PAYMENT_ID,
                amount: '5000.00',
                currency: 'UAH',
                status: PaymentStatus.PAID,
                paidAt: new Date('2026-08-10T00:00:00.000Z'),
              },
            },
            {
              student: expect.objectContaining({
                id: 'student-2',
                group: null,
              }),
              status: PaymentStatus.NOT_PAID,
              currentPayment: null,
            },
          ],
          pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
        });

        const args = prisma.student.findMany.mock.calls[0][0] as {
          where: { AND: unknown[] };
          orderBy: unknown;
          skip: number;
          take: number;
        };
        expect(args.where.AND).toEqual([
          {
            organizationId: 'org-1',
            user: {
              organizationId: 'org-1',
              role: UserRole.STUDENT,
              deletedAt: null,
            },
          },
        ]);
        expect(args.orderBy).toEqual([
          { user: { lastName: 'asc' } },
          { user: { firstName: 'asc' } },
          { id: 'asc' },
        ]);
        expect(args.skip).toBe(0);
        expect(args.take).toBe(20);
      },
    );

    it('applies search, group, status filters, sorting and pagination', async () => {
      await service.overview(actor(UserRole.ADMIN), {
        search: 'Коваль',
        groupId: 'group-1',
        status: PaymentStatus.NOT_PAID,
        sortBy: 'paidAt',
        sortOrder: 'desc',
        page: 3,
        limit: 10,
      });

      const args = prisma.student.findMany.mock.calls[0][0] as {
        where: { AND: unknown[] };
        orderBy: unknown;
        skip: number;
      };
      expect(args.where.AND).toContainEqual({
        user: { OR: expect.arrayContaining([{ lastName: expect.anything() }]) },
      });
      expect(args.where.AND).toContainEqual({ groupId: 'group-1' });
      expect(args.where.AND).toContainEqual({
        OR: [
          { currentPaymentId: null },
          { currentPayment: { is: { status: PaymentStatus.NOT_PAID } } },
        ],
      });
      expect(args.orderBy).toEqual([
        { currentPayment: { paidAt: { sort: 'desc', nulls: 'last' } } },
        { user: { lastName: 'asc' } },
        { id: 'asc' },
      ]);
      expect(args.skip).toBe(20);
      expect(prisma.student.count).toHaveBeenCalledWith({ where: args.where });
    });

    it('filters PAID by the current payment status', async () => {
      await service.overview(actor(UserRole.ADMIN), {
        status: PaymentStatus.PAID,
      });

      const args = prisma.student.findMany.mock.calls[0][0] as {
        where: { AND: unknown[] };
      };
      expect(args.where.AND).toContainEqual({
        currentPayment: { is: { status: PaymentStatus.PAID } },
      });
    });
  });

  describe('records', () => {
    it('lists payment rows of the organization with the student and the current flag', async () => {
      prisma.payment.findMany.mockResolvedValue([
        {
          ...paymentRow(),
          student: {
            ...paymentStudent(),
            studentProfile: {
              ...paymentStudent().studentProfile,
              currentPaymentId: PAYMENT_ID,
            },
          },
        },
        {
          ...notPaidRow({ id: 'payment-old' }),
          student: {
            ...paymentStudent(),
            studentProfile: {
              ...paymentStudent().studentProfile,
              currentPaymentId: PAYMENT_ID,
            },
          },
        },
      ]);
      prisma.payment.count.mockResolvedValue(2);

      const result = await service.records(actor(UserRole.ADMIN), {});

      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: 'org-1' },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: 0,
          take: 20,
        }),
      );
      expect(result.payments.map((row) => [row.id, row.isCurrent])).toEqual([
        [PAYMENT_ID, true],
        ['payment-old', false],
      ]);
      expect(result.payments[0]).toMatchObject({
        amount: '5000.00',
        purpose: 'Курс теорії',
        status: PaymentStatus.PAID,
        student: { id: STUDENT_ID, group: { id: 'group-1' } },
      });
      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
      });
    });

    it('filters by student, status, group, search and paid date range', async () => {
      await service.records(actor(UserRole.ADMIN), {
        studentId: STUDENT_ID,
        status: PaymentStatus.PAID,
        groupId: 'group-1',
        search: 'Коваль',
        paidFrom: '2026-08-01',
        paidTo: '2026-09-01',
        sortBy: 'paidAt',
        sortOrder: 'asc',
      });

      const args = prisma.payment.findMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
        orderBy: unknown;
      };
      expect(args.where).toMatchObject({
        organizationId: 'org-1',
        studentId: STUDENT_ID,
        status: PaymentStatus.PAID,
        paidAt: { gte: new Date('2026-08-01'), lt: new Date('2026-09-01') },
        student: {
          AND: [
            {
              studentProfile: {
                is: { organizationId: 'org-1', groupId: 'group-1' },
              },
            },
            { OR: expect.any(Array) },
          ],
        },
      });
      expect(args.orderBy).toEqual([
        { paidAt: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'desc' },
        { id: 'desc' },
      ]);
    });

    it('rejects paidTo that is not after paidFrom', async () => {
      await expect(
        service.records(actor(UserRole.ADMIN), {
          paidFrom: '2026-09-01',
          paidTo: '2026-09-01',
        }),
      ).rejects.toMatchObject({
        response: {
          errors: [{ field: 'paidTo', message: PAID_RANGE_MESSAGE }],
        },
      });
      expect(prisma.payment.findMany).not.toHaveBeenCalled();
    });
  });

  describe('history', () => {
    it('rejects a range where to is not after from', async () => {
      await expect(
        service.history(actor(UserRole.ADMIN), {
          from: '2026-09-01',
          to: '2026-08-01',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.history(actor(UserRole.ADMIN), {
          from: '2026-09-01',
          to: '2026-08-01',
        }),
      ).rejects.toMatchObject({
        response: { errors: [{ field: 'to', message: HISTORY_RANGE_MESSAGE }] },
      });
      expect(prisma.paymentHistory.findMany).not.toHaveBeenCalled();
    });

    it('filters by organization, student, payment, action and range', async () => {
      prisma.paymentHistory.findMany.mockResolvedValue([
        historyRow({
          action: PaymentHistoryAction.UPDATED,
          previousStatus: PaymentStatus.PAID,
          changes: {
            amount: { from: '5000.00', to: '5500.00' },
            unknown: { from: 'x', to: 'y' },
          },
        }),
      ]);
      prisma.paymentHistory.count.mockResolvedValue(1);

      const result = await service.history(actor(UserRole.ADMIN), {
        studentId: STUDENT_ID,
        paymentId: PAYMENT_ID,
        action: PaymentHistoryAction.UPDATED,
        from: '2026-08-01',
        to: '2026-09-01',
      });

      expect(prisma.paymentHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: 'org-1',
            paymentId: PAYMENT_ID,
            payment: { studentId: STUDENT_ID },
            action: PaymentHistoryAction.UPDATED,
            changedAt: {
              gte: new Date('2026-08-01'),
              lt: new Date('2026-09-01'),
            },
          },
          orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
        }),
      );
      expect(result.history[0]).toMatchObject({
        studentId: STUDENT_ID,
        action: PaymentHistoryAction.UPDATED,
        changes: { amount: { from: '5000.00', to: '5500.00' } },
      });
      expect(result.history[0].changes).not.toHaveProperty('unknown');
    });
  });

  describe('getById', () => {
    it('returns 404 for a payment outside the organization and logs the attempt', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);

      await expect(
        service.getById(actor(UserRole.ADMIN), PAYMENT_ID),
      ).rejects.toThrow(new NotFoundException(PAYMENT_NOT_FOUND_MESSAGE));
      expect(prisma.payment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: PAYMENT_ID, organizationId: 'org-1' },
        }),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('reason=not_found'),
      );
    });

    it('returns the payment, its student and history', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        ...paymentRow(),
        student: paymentStudent(),
        history: [historyRow()],
      });

      await expect(
        service.getById(actor(UserRole.ADMIN), PAYMENT_ID),
      ).resolves.toMatchObject({
        id: PAYMENT_ID,
        amount: '5000.00',
        comment: 'Готівка',
        student: { id: STUDENT_ID, group: { id: 'group-1' } },
        history: [
          {
            action: PaymentHistoryAction.CREATED,
            previousStatus: null,
            newStatus: PaymentStatus.PAID,
            changes: null,
          },
        ],
      });
    });
  });

  describe('create', () => {
    beforeEach(() => {
      // clearAllMocks не скидає mockResolvedValue інших тестів: без оплати з таким ключем.
      prisma.payment.findFirst.mockReset();
      prisma.payment.findFirst.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(studentUserRow());
      prisma.payment.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...paymentRow(), ...data }),
      );
    });

    it('creates a PAID payment, writes CREATED history and moves the current payment', async () => {
      const result = await service.create(actor(UserRole.ADMIN), {
        purpose: 'Курс теорії',
        studentId: STUDENT_ID,
        amount: 5000.5,
        paidAt: '2026-08-10',
        comment: 'Готівка',
      });

      expectStudentLock(STUDENT_ID);
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: STUDENT_ID,
            organizationId: 'org-1',
            role: UserRole.STUDENT,
            deletedAt: null,
            studentProfile: { is: { organizationId: 'org-1' } },
          },
        }),
      );
      const data = (
        prisma.payment.create.mock.calls[0][0] as {
          data: Record<string, unknown>;
        }
      ).data;
      expect(data).toEqual({
        organizationId: 'org-1',
        studentId: STUDENT_ID,
        amount: new Prisma.Decimal('5000.5'),
        currency: 'UAH',
        status: PaymentStatus.PAID,
        paidAt: new Date('2026-08-10'),
        purpose: 'Курс теорії',
        comment: 'Готівка',
        createdById: 'admin-1',
        idempotencyKey: null,
        requestHash: null,
      });
      expect(prisma.paymentHistory.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          paymentId: PAYMENT_ID,
          action: PaymentHistoryAction.CREATED,
          previousStatus: null,
          newStatus: PaymentStatus.PAID,
          changedById: 'admin-1',
        },
      });
      expect(prisma.student.update).toHaveBeenCalledWith({
        where: { id: 'profile-1' },
        data: { currentPaymentId: PAYMENT_ID },
      });
      expect(result).toMatchObject({
        amount: '5000.50',
        status: PaymentStatus.PAID,
      });
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Payment created paymentId=${PAYMENT_ID}`),
      );
    });

    it('lets OWNER record a NOT_PAID payment with zero amount and no date', async () => {
      await service.create(actor(UserRole.OWNER), {
        purpose: 'Курс теорії',
        studentId: STUDENT_ID,
        amount: 0,
        status: PaymentStatus.NOT_PAID,
        currency: 'EUR',
      });

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: PaymentStatus.NOT_PAID,
            paidAt: null,
            currency: 'EUR',
            createdById: 'owner-1',
          }),
        }),
      );
    });

    it.each([
      [
        'PAID without paidAt',
        { amount: 100 },
        'paidAt',
        PAID_AT_REQUIRED_MESSAGE,
      ],
      [
        'PAID with zero amount',
        { amount: 0, paidAt: '2026-08-10' },
        'amount',
        PAID_AMOUNT_POSITIVE_MESSAGE,
      ],
      [
        'NOT_PAID with paidAt',
        {
          amount: 100,
          status: PaymentStatus.NOT_PAID,
          paidAt: '2026-08-10',
        },
        'paidAt',
        PAID_AT_FORBIDDEN_MESSAGE,
      ],
      [
        'paidAt in the future',
        { amount: 100, paidAt: '2099-01-01' },
        'paidAt',
        PAID_AT_FUTURE_MESSAGE,
      ],
      [
        'paidAt before 2000',
        { amount: 100, paidAt: '1999-12-31' },
        'paidAt',
        PAID_AT_TOO_EARLY_MESSAGE,
      ],
    ])('rejects %s with 400', async (_case, body, field, message) => {
      await expect(
        service.create(actor(UserRole.ADMIN), {
          purpose: 'Курс теорії',
          studentId: STUDENT_ID,
          ...body,
        }),
      ).rejects.toMatchObject({
        response: { statusCode: 400, errors: [{ field, message }] },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    describe('paidAt in the school calendar (Europe/Kyiv)', () => {
      afterEach(() => {
        jest.useRealTimers();
      });

      // 00:30 15 листопада за Києвом — у UTC ще 14-те.
      const kyivJustAfterMidnight = new Date('2026-11-14T22:30:00.000Z');

      it.each(['2026-11-15', '2026-11-15T00:10:00+02:00'])(
        'accepts today in the school timezone (%s) while UTC is still yesterday',
        async (paidAt) => {
          jest.useFakeTimers({ now: kyivJustAfterMidnight });

          await expect(
            service.create(actor(UserRole.ADMIN), {
              purpose: 'Курс теорії',
              studentId: STUDENT_ID,
              amount: 100,
              paidAt,
            }),
          ).resolves.toMatchObject({ status: PaymentStatus.PAID });
        },
      );

      it.each(['2026-11-16', '2026-11-16T00:10:00+02:00'])(
        'rejects tomorrow in the school timezone (%s)',
        async (paidAt) => {
          jest.useFakeTimers({ now: kyivJustAfterMidnight });

          await expect(
            service.create(actor(UserRole.ADMIN), {
              purpose: 'Курс теорії',
              studentId: STUDENT_ID,
              amount: 100,
              paidAt,
            }),
          ).rejects.toMatchObject({
            response: {
              errors: [{ field: 'paidAt', message: PAID_AT_FUTURE_MESSAGE }],
            },
          });
        },
      );
    });

    describe('Idempotency-Key', () => {
      const KEY = '3f0c2a6e-6b1d-4f7e-9c2a-1b2c3d4e5f60';
      const body = {
        purpose: 'Курс теорії',
        studentId: STUDENT_ID,
        amount: 5000,
        paidAt: '2026-08-10',
      };

      function createdData() {
        return (
          prisma.payment.create.mock.calls[0][0] as {
            data: { idempotencyKey: string; requestHash: string };
          }
        ).data;
      }

      it('stores the key with a hash of the request on the first call', async () => {
        await service.create(actor(UserRole.ADMIN), body, KEY);

        expect(prisma.payment.findFirst).toHaveBeenCalledWith({
          where: { organizationId: 'org-1', idempotencyKey: KEY },
          select: expect.objectContaining({ requestHash: true }),
        });
        expect(createdData().idempotencyKey).toBe(KEY);
        expect(createdData().requestHash).toMatch(/^[0-9a-f]{64}$/);
      });

      it('returns the existing payment for a repeated request and creates nothing', async () => {
        await service.create(actor(UserRole.ADMIN), body, KEY);
        const { requestHash } = createdData();
        jest.clearAllMocks();
        prisma.organization.findUnique.mockResolvedValue({
          deletedAt: null,
          timezone: 'Europe/Kyiv',
        });
        prisma.payment.findFirst.mockResolvedValue({
          ...paymentRow(),
          requestHash,
        });

        // 5000.00 і повна дата — той самий запит, що 5000 і '2026-08-10'.
        const result = await service.create(
          actor(UserRole.ADMIN),
          { ...body, amount: 5000.0, paidAt: '2026-08-10T00:00:00.000Z' },
          KEY,
        );

        expect(result.id).toBe(PAYMENT_ID);
        expect(prisma.payment.create).not.toHaveBeenCalled();
        expect(prisma.paymentHistory.create).not.toHaveBeenCalled();
        expect(prisma.student.update).not.toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalledWith(
          expect.stringContaining('Payment create replayed'),
        );
      });

      it('returns 409 when the key is reused with other data', async () => {
        prisma.payment.findFirst.mockResolvedValue({
          ...paymentRow(),
          requestHash: 'f'.repeat(64),
        });

        await expect(
          service.create(actor(UserRole.ADMIN), body, KEY),
        ).rejects.toThrow(
          new ConflictException(IDEMPOTENCY_KEY_REUSED_MESSAGE),
        );
        expect(prisma.payment.create).not.toHaveBeenCalled();
      });

      it('rejects a malformed key with 400 before touching the database', async () => {
        await expect(
          service.create(actor(UserRole.ADMIN), body, 'short'),
        ).rejects.toMatchObject({
          response: {
            errors: [
              {
                field: IDEMPOTENCY_KEY_HEADER,
                message: IDEMPOTENCY_KEY_FORMAT_MESSAGE,
              },
            ],
          },
        });
        expect(prisma.organization.findUnique).not.toHaveBeenCalled();
      });

      it('answers a concurrent duplicate that lost the unique index race as a replay', async () => {
        await service.create(actor(UserRole.ADMIN), body, KEY);
        const { requestHash } = createdData();
        prisma.payment.findFirst
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ ...paymentRow(), requestHash });
        prisma.payment.create.mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('Unique constraint', {
            code: 'P2002',
            clientVersion: 'test',
            meta: { target: ['organizationId', 'idempotencyKey'] },
          }),
        );

        await expect(
          service.create(actor(UserRole.ADMIN), body, KEY),
        ).resolves.toMatchObject({ id: PAYMENT_ID });
      });
    });

    it('returns 404 for a student of another organization', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.create(actor(UserRole.ADMIN), {
          purpose: 'Курс теорії',
          studentId: STUDENT_ID,
          amount: 100,
          paidAt: '2026-08-10',
        }),
      ).rejects.toThrow(
        new NotFoundException(PAYMENT_STUDENT_NOT_FOUND_MESSAGE),
      );
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it.each([
      ['account', { status: UserStatus.ARCHIVED }],
      ['training', { trainingStatus: TrainingStatus.ARCHIVED }],
    ] as const)(
      'returns 409 for a student with an archived %s status',
      async (_kind, overrides) => {
        prisma.user.findFirst.mockResolvedValue(studentUserRow(overrides));

        await expect(
          service.create(actor(UserRole.ADMIN), {
            purpose: 'Курс теорії',
            studentId: STUDENT_ID,
            amount: 100,
            paidAt: '2026-08-10',
          }),
        ).rejects.toThrow(new ConflictException(STUDENT_ARCHIVED_MESSAGE));
        expect(prisma.payment.create).not.toHaveBeenCalled();
      },
    );
  });

  describe('update', () => {
    beforeEach(() => {
      prisma.payment.findFirst.mockResolvedValue(paymentRow());
      prisma.payment.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...paymentRow(), ...data }),
      );
    });

    it('rejects an empty body before reading the payment', async () => {
      await expect(
        service.update(actor(UserRole.ADMIN), PAYMENT_ID, {}),
      ).rejects.toMatchObject({
        response: {
          errors: [{ field: 'body', message: NO_PAYMENT_FIELDS_MESSAGE }],
        },
      });
      expect(prisma.payment.findFirst).not.toHaveBeenCalled();
    });

    it('returns 404 for a payment outside the organization', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);

      await expect(
        service.update(actor(UserRole.ADMIN), PAYMENT_ID, { amount: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('updates the changed fields and writes an UPDATED diff under the student lock', async () => {
      const result = await service.update(actor(UserRole.ADMIN), PAYMENT_ID, {
        amount: 5500,
        comment: null,
        currency: 'UAH',
      });

      expectStudentLock(STUDENT_ID);
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: PAYMENT_ID },
          data: {
            amount: new Prisma.Decimal('5500'),
            currency: 'UAH',
            paidAt: new Date('2026-08-10T00:00:00.000Z'),
            purpose: 'Курс теорії',
            comment: null,
          },
        }),
      );
      expect(prisma.paymentHistory.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          paymentId: PAYMENT_ID,
          action: PaymentHistoryAction.UPDATED,
          previousStatus: PaymentStatus.PAID,
          newStatus: PaymentStatus.PAID,
          changes: {
            amount: { from: '5000.00', to: '5500.00' },
            comment: { from: 'Готівка', to: null },
          },
          changedById: 'admin-1',
        },
      });
      expect(result.amount).toBe('5500.00');
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('fields=amount,comment'),
      );
    });

    it('records a purpose change in the UPDATED diff', async () => {
      await service.update(actor(UserRole.ADMIN), PAYMENT_ID, {
        purpose: 'Практичне водіння, 10 годин',
      });

      expect(prisma.paymentHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: PaymentHistoryAction.UPDATED,
          changes: {
            purpose: {
              from: 'Курс теорії',
              to: 'Практичне водіння, 10 годин',
            },
          },
        }),
      });
    });

    it('writes nothing when the values are unchanged', async () => {
      await service.update(actor(UserRole.ADMIN), PAYMENT_ID, {
        amount: 5000,
        currency: 'UAH',
      });

      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.paymentHistory.create).not.toHaveBeenCalled();
    });

    it('rejects paidAt on a NOT_PAID payment', async () => {
      prisma.payment.findFirst.mockResolvedValue(notPaidRow());

      await expect(
        service.update(actor(UserRole.ADMIN), PAYMENT_ID, {
          paidAt: '2026-08-10',
        }),
      ).rejects.toMatchObject({
        response: {
          errors: [{ field: 'paidAt', message: PAID_AT_FORBIDDEN_MESSAGE }],
        },
      });
    });

    it('rejects a zero amount on a PAID payment', async () => {
      await expect(
        service.update(actor(UserRole.ADMIN), PAYMENT_ID, { amount: 0 }),
      ).rejects.toMatchObject({
        response: {
          errors: [{ field: 'amount', message: PAID_AMOUNT_POSITIVE_MESSAGE }],
        },
      });
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });
  });

  describe('changeStatus', () => {
    beforeEach(() => {
      prisma.payment.findFirst.mockResolvedValue(notPaidRow());
      prisma.payment.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...notPaidRow(), ...data }),
      );
    });

    it('confirms NOT_PAID → PAID and writes STATUS_CHANGED history', async () => {
      const result = await service.changeStatus(
        actor(UserRole.ADMIN),
        PAYMENT_ID,
        {
          status: PaymentStatus.PAID,
          paidAt: '2026-08-11',
          comment: 'Підтверджено банком',
        },
      );

      expectStudentLock(STUDENT_ID);
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: PAYMENT_ID },
          data: { status: PaymentStatus.PAID, paidAt: new Date('2026-08-11') },
        }),
      );
      expect(prisma.paymentHistory.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          paymentId: PAYMENT_ID,
          action: PaymentHistoryAction.STATUS_CHANGED,
          previousStatus: PaymentStatus.NOT_PAID,
          newStatus: PaymentStatus.PAID,
          changedById: 'admin-1',
          comment: 'Підтверджено банком',
        },
      });
      expect(result.status).toBe(PaymentStatus.PAID);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('previousStatus=NOT_PAID newStatus=PAID'),
      );
    });

    it('uses the request time as paidAt by default', async () => {
      const before = Date.now();
      await service.changeStatus(actor(UserRole.ADMIN), PAYMENT_ID, {
        status: PaymentStatus.PAID,
      });

      const data = (
        prisma.payment.update.mock.calls[0][0] as { data: { paidAt: Date } }
      ).data;
      expect(data.paidAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(data.paidAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('returns 409 when the payment is already PAID', async () => {
      prisma.payment.findFirst.mockResolvedValue(paymentRow());

      await expect(
        service.changeStatus(actor(UserRole.ADMIN), PAYMENT_ID, {
          status: PaymentStatus.NOT_PAID,
        }),
      ).rejects.toThrow(new ConflictException(PAYMENT_FINAL_STATUS_MESSAGE));
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(prisma.paymentHistory.create).not.toHaveBeenCalled();
    });

    it('returns 409 when the status does not change', async () => {
      await expect(
        service.changeStatus(actor(UserRole.ADMIN), PAYMENT_ID, {
          status: PaymentStatus.NOT_PAID,
        }),
      ).rejects.toThrow(
        new ConflictException(PAYMENT_STATUS_UNCHANGED_MESSAGE),
      );
    });

    it('returns 409 when a zero-amount payment would become PAID', async () => {
      prisma.payment.findFirst.mockResolvedValue(
        notPaidRow({ amount: new Prisma.Decimal(0) }),
      );

      await expect(
        service.changeStatus(actor(UserRole.ADMIN), PAYMENT_ID, {
          status: PaymentStatus.PAID,
        }),
      ).rejects.toThrow(new ConflictException(PAID_AMOUNT_POSITIVE_MESSAGE));
    });

    it('returns 404 for a payment outside the organization', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);

      await expect(
        service.changeStatus(actor(UserRole.ADMIN), PAYMENT_ID, {
          status: PaymentStatus.PAID,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('student summaries', () => {
    const paid = paymentRow({ id: 'payment-1' });
    const latest = notPaidRow({
      id: 'payment-2',
      amount: new Prisma.Decimal('3000'),
      comment: 'Друга частина',
    });
    const usd = paymentRow({
      id: 'payment-3',
      amount: new Prisma.Decimal('100.25'),
      currency: 'USD',
    });

    it('returns the current status, paid totals per currency and history to ADMIN', async () => {
      prisma.user.findFirst.mockResolvedValue({
        studentProfile: { currentPaymentId: 'payment-2' },
        studentPayments: [latest, usd, paid],
      });

      const summary = await service.forStudent(
        actor(UserRole.ADMIN),
        STUDENT_ID,
      );

      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: STUDENT_ID,
            organizationId: 'org-1',
            role: UserRole.STUDENT,
            deletedAt: null,
            studentProfile: { is: { organizationId: 'org-1' } },
          },
        }),
      );
      expect(summary).toMatchObject({
        status: PaymentStatus.NOT_PAID,
        currentPayment: { id: 'payment-2', comment: 'Друга частина' },
        totalsPaid: [
          { currency: 'UAH', amount: '5000.00' },
          { currency: 'USD', amount: '100.25' },
        ],
      });
      expect(summary.payments.map((payment) => payment.id)).toEqual([
        'payment-2',
        'payment-3',
        'payment-1',
      ]);
    });

    it('returns NOT_PAID with no payments at all', async () => {
      prisma.user.findFirst.mockResolvedValue({
        studentProfile: { currentPaymentId: null },
        studentPayments: [],
      });

      await expect(
        service.forStudent(actor(UserRole.OWNER), STUDENT_ID),
      ).resolves.toEqual({
        status: PaymentStatus.NOT_PAID,
        currentPayment: null,
        totalsPaid: [],
        payments: [],
      });
    });

    it('returns 404 for a student of another organization', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.forStudent(actor(UserRole.ADMIN), STUDENT_ID),
      ).rejects.toThrow(
        new NotFoundException(PAYMENT_STUDENT_NOT_FOUND_MESSAGE),
      );
    });

    it('shows a student only their own payments, without the admin comment', async () => {
      prisma.user.findFirst.mockResolvedValue({
        studentProfile: { currentPaymentId: 'payment-1' },
        studentPayments: [paid],
      });
      const student = actor(UserRole.STUDENT);

      const summary = await service.own(student);

      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: student.id,
            organizationId: 'org-1',
          }),
        }),
      );
      expect(summary.status).toBe(PaymentStatus.PAID);
      expect(summary.currentPayment).not.toHaveProperty('comment');
      expect(summary.payments[0]).not.toHaveProperty('comment');
    });
  });
});
