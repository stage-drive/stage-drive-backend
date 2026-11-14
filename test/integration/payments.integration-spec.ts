import { execFileSync } from 'child_process';
import {
  ConflictException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  LicenseCategory,
  PaymentHistoryAction,
  PaymentStatus,
  Prisma,
  PrismaClient,
  TrainingStatus,
  Transmission,
  User,
  UserRole,
} from '@prisma/client';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { InvitationEmailQueue } from '../../src/modules/invitations/invitation-email.queue';
import { LessonsService } from '../../src/modules/lessons/lessons.service';
import {
  PRACTICE_PAYMENT_REQUIRED_MESSAGE,
  PracticePaymentService,
} from '../../src/modules/lessons/practice-payment.service';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { StudentsService } from '../../src/modules/students/students.service';
import { PrismaService } from '../../src/prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function delay(ms: number) {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * Модуль 13 проти справжнього Postgres: CHECK і складені FK з міграції,
 * запити Prisma (фільтри й сортування за останньою оплатою), блокування
 * студента і перевірка оплати під час запису практики.
 */
describe('Payments (integration, real Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let paymentsService: PaymentsService;
  let lessonsService: LessonsService;
  let studentsService: StudentsService;
  let sequence = 0;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const databaseUrl = container.getConnectionUri();

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    });

    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    });
    await prisma.$connect();

    const service = prisma as unknown as PrismaService;
    paymentsService = new PaymentsService(service);
    lessonsService = new LessonsService(service, new PracticePaymentService());
    studentsService = new StudentsService(service, {} as InvitationEmailQueue);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  /** Автошкола: ADMIN, інструктор з авто і студенти на практиці без оплат. */
  async function createSchool() {
    sequence += 1;
    const organization = await prisma.organization.create({
      data: {
        name: `Payments School ${sequence}`,
        slug: `payments-school-${sequence}`,
        email: `payments-${sequence}@example.com`,
      },
    });
    const userData = (role: UserRole, suffix: string) => ({
      organizationId: organization.id,
      email: `${role.toLowerCase()}-${suffix}-${sequence}@payments.example.com`,
      firstName: `First-${suffix}`,
      lastName: `Last-${suffix}`,
      role,
    });
    const admin: User = await prisma.user.create({
      data: userData(UserRole.ADMIN, 'a'),
    });
    const instructor = await prisma.user.create({
      data: userData(UserRole.INSTRUCTOR, 'i'),
    });
    const car = await prisma.car.create({
      data: {
        organizationId: organization.id,
        instructorId: instructor.id,
        plateNumber: `PA${sequence}01BB`,
        category: LicenseCategory.B,
        transmission: Transmission.MANUAL,
      },
    });
    const student = (suffix: string) =>
      prisma.user.create({
        data: {
          ...userData(UserRole.STUDENT, suffix),
          studentProfile: {
            create: {
              organizationId: organization.id,
              instructorId: instructor.id,
              carId: car.id,
              category: LicenseCategory.B,
              transmission: Transmission.MANUAL,
              trainingStatus: TrainingStatus.PRACTICE,
            },
          },
        },
      });
    const student1 = await student('s1');
    const student2 = await student('s2');
    return { organization, admin, instructor, car, student1, student2 };
  }

  function insertPayment(
    data: Omit<Prisma.PaymentUncheckedCreateInput, 'purpose'>,
  ) {
    return prisma.payment.create({
      data: { purpose: 'Курс теорії', ...data },
    });
  }

  describe('database constraints', () => {
    it.each([
      ['PAID without paid_at', { status: PaymentStatus.PAID, amount: 100 }],
      [
        'NOT_PAID with paid_at',
        { status: PaymentStatus.NOT_PAID, amount: 100, paidAt: new Date() },
      ],
      ['a negative amount', { status: PaymentStatus.NOT_PAID, amount: -1 }],
      [
        'a PAID payment of zero',
        { status: PaymentStatus.PAID, amount: 0, paidAt: new Date() },
      ],
      [
        'a lowercase currency',
        { status: PaymentStatus.NOT_PAID, amount: 1, currency: 'uah' },
      ],
    ])('rejects %s with a CHECK', async (_case, fields) => {
      const school = await createSchool();

      await expect(
        insertPayment({
          organizationId: school.organization.id,
          studentId: school.student1.id,
          createdById: school.admin.id,
          ...fields,
        }),
      ).rejects.toThrow(/check constraint/i);
    });

    it('rejects a payment for a student of another organization', async () => {
      const school = await createSchool();
      const other = await createSchool();

      await expect(
        insertPayment({
          organizationId: school.organization.id,
          studentId: other.student1.id,
          createdById: school.admin.id,
          status: PaymentStatus.NOT_PAID,
          amount: 1,
        }),
      ).rejects.toThrow(/foreign key/i);
    });

    it('lets the current-payment pointer reference only the student own payment', async () => {
      const school = await createSchool();
      const payment = await insertPayment({
        organizationId: school.organization.id,
        studentId: school.student1.id,
        createdById: school.admin.id,
        status: PaymentStatus.NOT_PAID,
        amount: 1,
      });

      await expect(
        prisma.student.update({
          where: { userId: school.student2.id },
          data: { currentPaymentId: payment.id },
        }),
      ).rejects.toThrow(/foreign key/i);
      await expect(
        prisma.student.update({
          where: { userId: school.student1.id },
          data: { currentPaymentId: payment.id },
        }),
      ).resolves.toMatchObject({ currentPaymentId: payment.id });
    });

    it('rejects a CREATED history event with a previous status', async () => {
      const school = await createSchool();
      const payment = await insertPayment({
        organizationId: school.organization.id,
        studentId: school.student1.id,
        createdById: school.admin.id,
        status: PaymentStatus.NOT_PAID,
        amount: 1,
      });

      await expect(
        prisma.paymentHistory.create({
          data: {
            organizationId: school.organization.id,
            paymentId: payment.id,
            action: PaymentHistoryAction.CREATED,
            previousStatus: PaymentStatus.NOT_PAID,
            newStatus: PaymentStatus.NOT_PAID,
            changedById: school.admin.id,
          },
        }),
      ).rejects.toThrow(/check constraint/i);
    });

    it('keeps a student with payments from being hard-deleted', async () => {
      const school = await createSchool();
      await paymentsService.create(school.admin, {
        purpose: 'Курс теорії',
        studentId: school.student1.id,
        amount: 100,
        paidAt: '2026-08-10',
      });

      await expect(
        prisma.user.delete({ where: { id: school.student1.id } }),
      ).rejects.toThrow(/foreign key/i);
    });

    it('still deletes a whole organization with payments and history', async () => {
      const school = await createSchool();
      const created = await paymentsService.create(school.admin, {
        purpose: 'Курс теорії',
        studentId: school.student1.id,
        amount: 0,
        status: PaymentStatus.NOT_PAID,
      });
      await paymentsService.update(school.admin, created.id, { amount: 10 });

      await prisma.organization.delete({
        where: { id: school.organization.id },
      });

      await expect(
        prisma.payment.count({
          where: { organizationId: school.organization.id },
        }),
      ).resolves.toBe(0);
      await expect(
        prisma.paymentHistory.count({
          where: { organizationId: school.organization.id },
        }),
      ).resolves.toBe(0);
    });
  });

  describe('payment lifecycle', () => {
    it('creates, edits and confirms a payment with an append-only history', async () => {
      const school = await createSchool();

      const created = await paymentsService.create(school.admin, {
        purpose: 'Курс теорії',
        studentId: school.student1.id,
        amount: 3000,
        status: PaymentStatus.NOT_PAID,
        comment: 'Очікується',
      });
      await paymentsService.update(school.admin, created.id, {
        amount: 3500.5,
        comment: null,
      });
      const confirmed = await paymentsService.changeStatus(
        school.admin,
        created.id,
        { status: PaymentStatus.PAID, paidAt: '2026-08-11' },
      );

      expect(confirmed).toMatchObject({
        amount: '3500.50',
        status: PaymentStatus.PAID,
        paidAt: new Date('2026-08-11'),
      });
      await expect(
        paymentsService.changeStatus(school.admin, created.id, {
          status: PaymentStatus.NOT_PAID,
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      const details = await paymentsService.getById(school.admin, created.id);
      expect(
        details.history.map((event) => [
          event.action,
          event.previousStatus,
          event.newStatus,
        ]),
      ).toEqual([
        [
          PaymentHistoryAction.STATUS_CHANGED,
          PaymentStatus.NOT_PAID,
          PaymentStatus.PAID,
        ],
        [
          PaymentHistoryAction.UPDATED,
          PaymentStatus.NOT_PAID,
          PaymentStatus.NOT_PAID,
        ],
        [PaymentHistoryAction.CREATED, null, PaymentStatus.NOT_PAID],
      ]);
      expect(details.history[1].changes).toEqual({
        amount: { from: '3000.00', to: '3500.50' },
        comment: { from: 'Очікується', to: null },
      });

      const feed = await paymentsService.history(school.admin, {
        studentId: school.student1.id,
        action: PaymentHistoryAction.STATUS_CHANGED,
      });
      expect(feed.pagination.total).toBe(1);
    });

    it('moves the current payment to the newest one, even under concurrent writes', async () => {
      const school = await createSchool();

      const results = await Promise.all(
        [100, 200, 300].map((amount) =>
          paymentsService.create(school.admin, {
            purpose: 'Курс теорії',
            studentId: school.student1.id,
            amount,
            paidAt: '2026-08-10',
          }),
        ),
      );

      const newest = await prisma.payment.findFirstOrThrow({
        where: { studentId: school.student1.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const profile = await prisma.student.findUniqueOrThrow({
        where: { userId: school.student1.id },
      });
      expect(results).toHaveLength(3);
      expect(profile.currentPaymentId).toBe(newest.id);
    });

    it('does not let an admin of another school read or change the payment', async () => {
      const school = await createSchool();
      const other = await createSchool();
      const created = await paymentsService.create(school.admin, {
        purpose: 'Курс теорії',
        studentId: school.student1.id,
        amount: 100,
        paidAt: '2026-08-10',
      });

      await expect(
        paymentsService.getById(other.admin, created.id),
      ).rejects.toThrow('Payment not found');
      await expect(
        paymentsService.update(other.admin, created.id, { amount: 1 }),
      ).rejects.toThrow('Payment not found');
      await expect(
        paymentsService.create(other.admin, {
          purpose: 'Курс теорії',
          studentId: school.student1.id,
          amount: 1,
          paidAt: '2026-08-10',
        }),
      ).rejects.toThrow('Student not found');
    });
  });

  describe('overview and students list', () => {
    it('filters and sorts students by the latest payment', async () => {
      const school = await createSchool();
      // student1: остання оплата PAID; student2: оплат немає.
      await paymentsService.create(school.admin, {
        purpose: 'Курс теорії',
        studentId: school.student1.id,
        amount: 5000,
        paidAt: '2026-08-10',
      });

      const paid = await paymentsService.overview(school.admin, {
        status: PaymentStatus.PAID,
      });
      const notPaid = await paymentsService.overview(school.admin, {
        status: PaymentStatus.NOT_PAID,
      });
      const byPaidAt = await paymentsService.overview(school.admin, {
        sortBy: 'paidAt',
        sortOrder: 'asc',
      });

      expect(paid.students.map((row) => row.student.id)).toEqual([
        school.student1.id,
      ]);
      expect(paid.students[0].currentPayment).toMatchObject({
        amount: '5000.00',
        currency: 'UAH',
      });
      expect(
        notPaid.students.map((row) => [
          row.student.id,
          row.status,
          row.currentPayment,
        ]),
      ).toEqual([[school.student2.id, PaymentStatus.NOT_PAID, null]]);
      // Студент без оплати — в кінці навіть при asc.
      expect(byPaidAt.students.map((row) => row.student.id)).toEqual([
        school.student1.id,
        school.student2.id,
      ]);
    });

    it('treats a newer NOT_PAID record as the current status', async () => {
      const school = await createSchool();
      await paymentsService.create(school.admin, {
        purpose: 'Курс теорії',
        studentId: school.student1.id,
        amount: 5000,
        paidAt: '2026-08-10',
      });
      await paymentsService.create(school.admin, {
        purpose: 'Курс теорії',
        studentId: school.student1.id,
        amount: 3000,
        status: PaymentStatus.NOT_PAID,
      });

      const summary = await paymentsService.forStudent(
        school.admin,
        school.student1.id,
      );
      expect(summary).toMatchObject({
        status: PaymentStatus.NOT_PAID,
        currentPayment: { amount: '3000.00' },
        totalsPaid: [{ currency: 'UAH', amount: '5000.00' }],
      });
      expect(summary.payments).toHaveLength(2);
    });

    it('filters the students list by the current payment status', async () => {
      const school = await createSchool();
      await paymentsService.create(school.admin, {
        purpose: 'Курс теорії',
        studentId: school.student1.id,
        amount: 5000,
        paidAt: '2026-08-10',
      });

      const paid = await studentsService.list(school.admin, {
        paymentStatus: PaymentStatus.PAID,
      });
      const notPaid = await studentsService.list(school.admin, {
        paymentStatus: PaymentStatus.NOT_PAID,
      });
      const card = await studentsService.getById(
        school.admin,
        school.student1.id,
      );

      expect(paid.students.map((row) => row.id)).toEqual([school.student1.id]);
      expect(paid.students[0].paymentStatus).toBe(PaymentStatus.PAID);
      expect(notPaid.students.map((row) => row.id)).toEqual([
        school.student2.id,
      ]);
      expect(card.payments).toMatchObject({
        status: PaymentStatus.PAID,
        totalsPaid: [{ currency: 'UAH', amount: '5000.00' }],
      });
    });
  });

  describe('purpose, records and idempotent create', () => {
    it('rejects a blank purpose at the database level', async () => {
      const school = await createSchool();

      await expect(
        insertPayment({
          organizationId: school.organization.id,
          studentId: school.student1.id,
          createdById: school.admin.id,
          status: PaymentStatus.NOT_PAID,
          amount: 1,
          purpose: '   ',
        } as Prisma.PaymentUncheckedCreateInput),
      ).rejects.toThrow(/check constraint/i);
    });

    it('shows the purpose to the student but not the admin comment', async () => {
      const school = await createSchool();
      await paymentsService.create(school.admin, {
        studentId: school.student1.id,
        amount: 5000,
        paidAt: '2026-08-10',
        purpose: 'Практичне водіння, 10 годин',
        comment: 'Готівка',
      });

      const own = await paymentsService.own({
        ...school.student1,
        role: UserRole.STUDENT,
      });

      expect(own.currentPayment).toMatchObject({
        purpose: 'Практичне водіння, 10 годин',
      });
      expect(own.currentPayment).not.toHaveProperty('comment');
    });

    it('lists payment records filtered by student and status', async () => {
      const school = await createSchool();
      const first = await paymentsService.create(school.admin, {
        studentId: school.student1.id,
        amount: 3000,
        paidAt: '2026-08-01',
        purpose: 'Перша частина',
      });
      const second = await paymentsService.create(school.admin, {
        studentId: school.student1.id,
        amount: 2000,
        status: PaymentStatus.NOT_PAID,
        purpose: 'Друга частина',
      });
      await paymentsService.create(school.admin, {
        studentId: school.student2.id,
        amount: 5000,
        paidAt: '2026-08-05',
        purpose: 'Курс',
      });

      const ofStudent = await paymentsService.records(school.admin, {
        studentId: school.student1.id,
      });
      const paidOfStudent = await paymentsService.records(school.admin, {
        studentId: school.student1.id,
        status: PaymentStatus.PAID,
      });
      const byPaidAt = await paymentsService.records(school.admin, {
        sortBy: 'paidAt',
        sortOrder: 'desc',
      });

      expect(
        ofStudent.payments.map((row) => [row.id, row.purpose, row.isCurrent]),
      ).toEqual([
        [second.id, 'Друга частина', true],
        [first.id, 'Перша частина', false],
      ]);
      expect(paidOfStudent.payments.map((row) => row.id)).toEqual([first.id]);
      // NOT_PAID без paidAt — у кінці навіть при desc.
      expect(byPaidAt.payments.map((row) => row.purpose)).toEqual([
        'Курс',
        'Перша частина',
        'Друга частина',
      ]);
    });

    it('creates one payment for a repeated request with the same Idempotency-Key', async () => {
      const school = await createSchool();
      const body = {
        studentId: school.student1.id,
        amount: 5000,
        paidAt: '2026-08-10',
        purpose: 'Курс теорії',
      };
      const key = '3f0c2a6e-6b1d-4f7e-9c2a-1b2c3d4e5f60';

      const results = await Promise.all([
        paymentsService.create(school.admin, body, key),
        paymentsService.create(school.admin, body, key),
        paymentsService.create(school.admin, { ...body, amount: 5000.0 }, key),
      ]);

      expect(new Set(results.map((payment) => payment.id)).size).toBe(1);
      await expect(
        prisma.payment.count({ where: { studentId: school.student1.id } }),
      ).resolves.toBe(1);
      await expect(
        prisma.paymentHistory.count({ where: { paymentId: results[0].id } }),
      ).resolves.toBe(1);
      await expect(
        paymentsService.create(school.admin, { ...body, amount: 4000 }, key),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('lets the same key race for two students: one wins, the other gets 409', async () => {
      const school = await createSchool();
      const key = 'race-key-for-two-students';
      const body = (studentId: string) => ({
        studentId,
        amount: 5000,
        paidAt: '2026-08-10',
        purpose: 'Курс теорії',
      });

      const outcomes = await Promise.allSettled([
        paymentsService.create(school.admin, body(school.student1.id), key),
        paymentsService.create(school.admin, body(school.student2.id), key),
      ]);

      expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      const rejected = outcomes.find(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === 'rejected',
      );
      expect(rejected?.reason).toBeInstanceOf(ConflictException);
      await expect(
        prisma.payment.count({
          where: { organizationId: school.organization.id },
        }),
      ).resolves.toBe(1);
    });

    it('scopes the key to the school', async () => {
      const school = await createSchool();
      const other = await createSchool();
      const key = 'shared-key-between-schools';

      const mine = await paymentsService.create(
        school.admin,
        {
          studentId: school.student1.id,
          amount: 100,
          paidAt: '2026-08-10',
          purpose: 'Курс',
        },
        key,
      );
      const theirs = await paymentsService.create(
        other.admin,
        {
          studentId: other.student1.id,
          amount: 100,
          paidAt: '2026-08-10',
          purpose: 'Курс',
        },
        key,
      );

      expect(theirs.id).not.toBe(mine.id);
    });
  });

  describe('practice gate', () => {
    function createPractice(
      school: Awaited<ReturnType<typeof createSchool>>,
      days: number,
    ) {
      const scheduledAt = new Date(Date.now() + days * DAY_MS);
      scheduledAt.setUTCHours(8, 0, 0, 0);
      return lessonsService.createPractice(school.admin, {
        studentId: school.student1.id,
        scheduledAt: scheduledAt.toISOString(),
        meetingPlace: 'Автодром',
      });
    }

    it('answers 422 until the current payment is PAID', async () => {
      const school = await createSchool();

      await expect(createPractice(school, 3)).rejects.toThrow(
        new UnprocessableEntityException(PRACTICE_PAYMENT_REQUIRED_MESSAGE),
      );

      const pending = await paymentsService.create(school.admin, {
        purpose: 'Курс теорії',
        studentId: school.student1.id,
        amount: 5000,
        status: PaymentStatus.NOT_PAID,
      });
      await expect(createPractice(school, 4)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );

      await paymentsService.changeStatus(school.admin, pending.id, {
        status: PaymentStatus.PAID,
      });
      await expect(createPractice(school, 5)).resolves.toMatchObject({
        type: 'PRACTICE',
        paymentStatus: PaymentStatus.PAID,
      });
      await expect(
        prisma.drivingLesson.count({
          where: { studentId: school.student1.id },
        }),
      ).resolves.toBe(1);
    });

    it('waits for a booking that holds the student lock before changing the payment', async () => {
      const school = await createSchool();
      const pending = await paymentsService.create(school.admin, {
        purpose: 'Курс теорії',
        studentId: school.student1.id,
        amount: 5000,
        status: PaymentStatus.NOT_PAID,
      });
      const locked = deferred();
      const release = deferred();

      // Те саме advisory-блокування, яке тримає бронювання практики.
      const booking = prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`student:${school.student1.id}`}::text, 0))`;
          locked.resolve();
          await release.promise;
        },
        { timeout: 20_000 },
      );
      await locked.promise;

      let settled = false;
      const change = paymentsService
        .changeStatus(school.admin, pending.id, { status: PaymentStatus.PAID })
        .finally(() => {
          settled = true;
        });
      await delay(300);
      expect(settled).toBe(false);

      release.resolve();
      await booking;
      await expect(change).resolves.toMatchObject({
        status: PaymentStatus.PAID,
      });
    });
  });
});
