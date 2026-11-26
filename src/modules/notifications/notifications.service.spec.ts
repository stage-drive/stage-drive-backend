import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import {
  CoursePublicationStatus,
  CourseStatus,
  NotificationEntityType,
  NotificationReadStatus,
  NotificationType,
  PaymentStatus,
  Prisma,
  TheoryTestPublicationStatus,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationEvent } from './notification-events';
import {
  NOTIFICATION_NOT_FOUND_MESSAGE,
  NotificationsService,
  RELATED_ENTITY_MISSING_MESSAGE,
  RELATED_ENTITY_NOT_FOUND_MESSAGE,
} from './notifications.service';

const ORG = 'org-1';
const WHEN = new Date('2026-11-26T08:00:00.000Z');

function actor(id = 'admin-1', role: UserRole = UserRole.ADMIN): User {
  return { id, organizationId: ORG, role } as User;
}

function uniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.9.1',
    meta: { target: ['organizationId', 'recipientId', 'dedupeKey'] },
  });
}

describe('NotificationsService', () => {
  const prisma = {
    organization: { findUnique: jest.fn() },
    user: { findFirst: jest.fn(), findMany: jest.fn() },
    group: { findFirst: jest.fn() },
    enrollment: { findMany: jest.fn(), findFirst: jest.fn() },
    theoryTest: { findFirst: jest.fn() },
    theoryTestAttempt: { findFirst: jest.fn() },
    lesson: { findFirst: jest.fn() },
    drivingLesson: { findFirst: jest.fn() },
    course: { findFirst: jest.fn() },
    payment: { findFirst: jest.fn() },
    notification: {
      create: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  let service: NotificationsService;
  let warn: jest.SpyInstance;
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.organization.findUnique.mockResolvedValue({
      id: ORG,
      deletedAt: null,
      timezone: 'Europe/Kyiv',
    });
    prisma.user.findFirst.mockResolvedValue({ organizationId: ORG });
    prisma.user.findMany.mockResolvedValue([]);
    prisma.notification.create.mockResolvedValue({ id: 'n-1' });
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    service = new NotificationsService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function scheduleCreated(actorId = 'admin-1'): NotificationEvent {
    return {
      kind: 'schedule.created',
      organizationId: ORG,
      actorId,
      lessonId: 'lesson-1',
      groupId: 'group-1',
      topic: 'ПДР',
      scheduledAt: WHEN,
    };
  }

  it('stores a schedule notification for the teacher and active students, not the actor', async () => {
    prisma.group.findFirst.mockResolvedValue({
      teacher: {
        id: 'teacher-1',
        organizationId: ORG,
        deletedAt: null,
        status: UserStatus.ACTIVE,
      },
      enrollments: [{ studentId: 'student-1' }, { studentId: 'admin-1' }],
    });
    prisma.user.findMany.mockResolvedValue([
      { id: 'teacher-1' },
      { id: 'student-1' },
    ]);

    await expect(service.record(scheduleCreated())).resolves.toBe(2);

    const rows = prisma.notification.create.mock.calls.map(
      (call) =>
        call[0].data as {
          recipientId: string;
          type: string;
          text: string;
          dedupeKey: string;
          readStatus: string;
          organizationId: string;
          entityType: string;
          entityId: string;
        },
    );
    expect(rows.map((row) => row.recipientId).sort()).toEqual([
      'student-1',
      'teacher-1',
    ]);
    expect(
      rows.every((row) => row.type === NotificationType.SCHEDULE_CREATED),
    ).toBe(true);
    expect(
      rows.every((row) => row.readStatus === NotificationReadStatus.UNREAD),
    ).toBe(true);
    expect(rows.every((row) => row.organizationId === ORG)).toBe(true);
    expect(rows[0].dedupeKey).toBe('schedule:lesson-1:created');
    expect(rows[0].entityType).toBe(NotificationEntityType.THEORY_LESSON);
    expect(rows[0].entityId).toBe('lesson-1');
    expect(rows[0].text).toContain('ПДР');
    expect(rows[0].text).toContain('10:00');
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: ORG,
          status: UserStatus.ACTIVE,
        }),
      }),
    );
  });

  it('skips a recipient who does not belong to the organization', async () => {
    prisma.group.findFirst.mockResolvedValue({
      teacher: {
        id: 'teacher-1',
        organizationId: ORG,
        deletedAt: null,
        status: UserStatus.ACTIVE,
      },
      enrollments: [{ studentId: 'student-1' }],
    });
    prisma.user.findMany.mockResolvedValue([{ id: 'student-1' }]);

    await expect(service.record(scheduleCreated())).resolves.toBe(1);
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('reason=not_in_organization userId=teacher-1'),
    );
  });

  it('does not create a second row when the same event is processed again', async () => {
    prisma.group.findFirst.mockResolvedValue({
      teacher: {
        id: 'teacher-1',
        organizationId: 'other-org',
        deletedAt: null,
        status: UserStatus.BLOCKED,
      },
      enrollments: [{ studentId: 'student-1' }],
    });
    prisma.user.findMany.mockResolvedValue([{ id: 'student-1' }]);
    prisma.notification.create.mockRejectedValue(uniqueConstraintError());

    await expect(service.record(scheduleCreated())).resolves.toBe(0);
    await expect(service.emit(scheduleCreated())).resolves.toBeUndefined();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('refuses an actor from another organization and does not fail the caller of emit', async () => {
    prisma.user.findFirst.mockResolvedValue({ organizationId: 'other-org' });
    const event: NotificationEvent = {
      kind: 'practice.confirmed',
      organizationId: ORG,
      actorId: 'outsider',
      lessonId: 'lesson-1',
      studentId: 'student-1',
      instructorId: 'instructor-1',
      scheduledAt: WHEN,
    };

    await expect(service.record(event)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.emit(event)).resolves.toBeUndefined();
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining(
        'Notification delivery failed kind=practice.confirmed',
      ),
    );
  });

  it('reports a missing organization and keeps emit from throwing', async () => {
    prisma.organization.findUnique.mockResolvedValue(null);

    await expect(service.record(scheduleCreated())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.emit(scheduleCreated())).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalled();
  });

  it('notifies the student about their own test result and a published test once', async () => {
    prisma.theoryTest.findFirst.mockResolvedValue({ name: 'Знаки' });
    prisma.user.findMany.mockResolvedValue([{ id: 'student-1' }]);
    const result: NotificationEvent = {
      kind: 'test.result',
      organizationId: ORG,
      actorId: 'student-1',
      studentId: 'student-1',
      attemptId: 'attempt-1',
      testId: 'test-1',
      passed: false,
      correctCount: 4,
      totalQuestions: 10,
    };

    await expect(service.record(result)).resolves.toBe(1);
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recipientId: 'student-1',
        type: NotificationType.TEST_FAILED,
        dedupeKey: 'attempt:attempt-1:result',
        text: 'Тест «Знаки» не складено: 4 з 10.',
      }),
    });

    prisma.enrollment.findMany.mockResolvedValue([
      { studentId: 'student-1' },
      { studentId: 'student-1' },
    ]);
    const publishedAt = new Date('2026-11-26T12:00:00.000Z');
    const published: NotificationEvent = {
      kind: 'test.published',
      organizationId: ORG,
      actorId: 'teacher-1',
      testId: 'test-1',
      courseId: 'course-1',
      name: 'Знаки',
      publishedAt,
    };
    prisma.user.findMany.mockResolvedValue([{ id: 'student-1' }]);
    await expect(service.record(published)).resolves.toBe(1);
    expect(prisma.notification.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        type: NotificationType.TEST_PUBLISHED,
        dedupeKey: `test:test-1:published:${publishedAt.toISOString()}`,
        recipientId: 'student-1',
      }),
    });
  });

  it('skips a retry of the same publication and notifies a later one', async () => {
    const first = new Date('2026-11-26T12:00:00.000Z');
    const later = new Date('2026-11-26T13:00:00.000Z');
    prisma.enrollment.findMany.mockResolvedValue([{ studentId: 'student-1' }]);
    prisma.user.findMany.mockResolvedValue([{ id: 'student-1' }]);
    const published = (publishedAt: Date): NotificationEvent => ({
      kind: 'test.published',
      organizationId: ORG,
      actorId: 'teacher-1',
      testId: 'test-1',
      courseId: 'course-1',
      name: 'Знаки',
      publishedAt,
    });

    await expect(service.record(published(first))).resolves.toBe(1);
    prisma.notification.create.mockRejectedValueOnce(uniqueConstraintError());
    await expect(service.record(published(first))).resolves.toBe(0);
    await expect(service.record(published(later))).resolves.toBe(1);
    expect(prisma.notification.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        dedupeKey: `test:test-1:published:${later.toISOString()}`,
      }),
    });
  });

  it('notifies the student about a new payment and keeps the status change idempotent', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'student-1' }]);
    const recorded: NotificationEvent = {
      kind: 'payment.recorded',
      organizationId: ORG,
      actorId: 'admin-1',
      paymentId: 'pay-1',
      studentId: 'student-1',
      status: PaymentStatus.PAID,
      purpose: 'Курс теорії',
      amount: '5000.00',
      currency: 'UAH',
    };

    await expect(service.record(recorded)).resolves.toBe(1);
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: NotificationType.PAYMENT_RECORDED,
        recipientId: 'student-1',
        dedupeKey: 'payment:pay-1:recorded',
        text: 'Оплату «Курс теорії» на суму 5000.00 UAH підтверджено.',
      }),
    });
  });

  it('logs a database failure and does not throw from emit', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'student-1' }]);
    prisma.notification.create.mockRejectedValue(new Error('db down'));

    await expect(
      service.emit({
        kind: 'practice.rejected',
        organizationId: ORG,
        actorId: 'instructor-1',
        lessonId: 'lesson-1',
        studentId: 'student-1',
        instructorId: 'instructor-1',
        scheduledAt: WHEN,
      }),
    ).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });

  it('lists and counts only the actor notifications in their organization', async () => {
    prisma.notification.count.mockResolvedValue(1);
    prisma.notification.findMany.mockResolvedValue([
      {
        id: 'n-1',
        type: NotificationType.SCHEDULE_CREATED,
        text: 'Заплановано.',
        readStatus: NotificationReadStatus.UNREAD,
        createdAt: WHEN,
        readAt: null,
        entityType: NotificationEntityType.THEORY_LESSON,
        entityId: 'lesson-1',
      },
    ]);

    const list = await service.list(actor('student-1'), {
      readStatus: NotificationReadStatus.UNREAD,
      page: 1,
      limit: 10,
    });

    expect(list.items).toEqual([
      expect.objectContaining({
        id: 'n-1',
        entity: {
          type: NotificationEntityType.THEORY_LESSON,
          id: 'lesson-1',
        },
      }),
    ]);
    expect(list.pagination.total).toBe(1);
    expect(list.unreadCount).toBe(1);
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: ORG,
          recipientId: 'student-1',
          readStatus: NotificationReadStatus.UNREAD,
        },
      }),
    );

    prisma.notification.count.mockResolvedValue(0);
    prisma.notification.findMany.mockResolvedValue([]);
    await expect(service.list(actor('student-1'))).resolves.toEqual({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      unreadCount: 0,
    });

    prisma.notification.count.mockResolvedValue(3);
    await expect(service.unreadCount(actor('student-1'))).resolves.toEqual({
      count: 3,
    });
  });

  it('marks only the owner notification as read and hides the rest', async () => {
    prisma.notification.findFirst.mockResolvedValue(null);
    await expect(service.markRead(actor(), 'n-1')).rejects.toMatchObject({
      message: NOTIFICATION_NOT_FOUND_MESSAGE,
    });

    const read = {
      id: 'n-1',
      type: NotificationType.PAYMENT_RECORDED,
      text: 'Оплату підтверджено.',
      readStatus: NotificationReadStatus.READ,
      createdAt: WHEN,
      readAt: WHEN,
      entityType: NotificationEntityType.PAYMENT,
      entityId: 'pay-1',
    };
    const readDto = {
      id: 'n-1',
      type: NotificationType.PAYMENT_RECORDED,
      text: 'Оплату підтверджено.',
      readStatus: NotificationReadStatus.READ,
      createdAt: WHEN,
      readAt: WHEN,
      entity: { type: NotificationEntityType.PAYMENT, id: 'pay-1' },
      unreadCount: 2,
    };
    prisma.notification.count.mockResolvedValue(2);
    prisma.notification.findFirst.mockResolvedValue(read);
    await expect(service.markRead(actor(), 'n-1')).resolves.toEqual(readDto);
    expect(prisma.notification.update).not.toHaveBeenCalled();

    prisma.notification.findFirst.mockResolvedValue({
      ...read,
      readStatus: NotificationReadStatus.UNREAD,
      readAt: null,
    });
    prisma.notification.update.mockResolvedValue(read);
    await expect(service.markRead(actor(), 'n-1')).resolves.toEqual(readDto);
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          readStatus: NotificationReadStatus.READ,
        }),
      }),
    );

    prisma.notification.findFirst.mockResolvedValue(read);
    prisma.notification.count.mockResolvedValue(3);
    prisma.notification.update.mockResolvedValue({
      ...read,
      readStatus: NotificationReadStatus.UNREAD,
      readAt: null,
    });
    await expect(service.markUnread(actor(), 'n-1')).resolves.toEqual({
      ...readDto,
      readStatus: NotificationReadStatus.UNREAD,
      readAt: null,
      unreadCount: 3,
    });
    expect(prisma.notification.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { readStatus: NotificationReadStatus.UNREAD, readAt: null },
      }),
    );
  });

  it('marks only the actor unread notifications and returns the new count', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 2 });
    prisma.notification.count.mockResolvedValue(0);

    await expect(service.markAllRead(actor('student-1'))).resolves.toEqual({
      updated: 2,
      unreadCount: 0,
    });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        recipientId: 'student-1',
        readStatus: NotificationReadStatus.UNREAD,
      },
      data: expect.objectContaining({
        readStatus: NotificationReadStatus.READ,
      }),
    });
  });

  it('returns a theory lesson the teacher of that group can open', async () => {
    prisma.notification.findFirst.mockResolvedValue({
      entityType: NotificationEntityType.THEORY_LESSON,
      entityId: 'lesson-1',
    });
    prisma.lesson.findFirst.mockResolvedValue({
      groupId: 'group-1',
      scheduledAt: WHEN,
      group: { teacherId: 'teacher-1' },
    });

    await expect(
      service.target(actor('teacher-1', UserRole.TEACHER), 'n-1'),
    ).resolves.toEqual({
      type: NotificationEntityType.THEORY_LESSON,
      id: 'lesson-1',
    });
  });

  it('hides another user notification and a missing or unlinked entity', async () => {
    prisma.notification.findFirst.mockResolvedValue(null);
    await expect(service.target(actor(), 'n-1')).rejects.toMatchObject({
      message: NOTIFICATION_NOT_FOUND_MESSAGE,
    });

    prisma.notification.findFirst.mockResolvedValue({
      entityType: null,
      entityId: null,
    });
    await expect(service.target(actor(), 'n-1')).rejects.toMatchObject({
      message: RELATED_ENTITY_MISSING_MESSAGE,
    });

    prisma.notification.findFirst.mockResolvedValue({
      entityType: NotificationEntityType.PRACTICE_LESSON,
      entityId: 'lesson-1',
    });
    prisma.drivingLesson.findFirst.mockResolvedValue(null);
    await expect(
      service.target(actor('student-1', UserRole.STUDENT), 'n-1'),
    ).rejects.toMatchObject({
      message: RELATED_ENTITY_NOT_FOUND_MESSAGE,
    });
  });

  it('refuses a practice lesson and a payment the actor cannot open', async () => {
    prisma.notification.findFirst.mockResolvedValue({
      entityType: NotificationEntityType.PRACTICE_LESSON,
      entityId: 'lesson-1',
    });
    prisma.drivingLesson.findFirst.mockResolvedValue({
      studentId: 'student-1',
      instructorId: 'instructor-1',
    });

    await expect(
      service.target(actor('student-2', UserRole.STUDENT), 'n-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.target(actor('instructor-1', UserRole.INSTRUCTOR), 'n-1'),
    ).resolves.toEqual({
      type: NotificationEntityType.PRACTICE_LESSON,
      id: 'lesson-1',
    });

    prisma.notification.findFirst.mockResolvedValue({
      entityType: NotificationEntityType.PAYMENT,
      entityId: 'pay-1',
    });
    prisma.payment.findFirst.mockResolvedValue({ studentId: 'student-1' });
    await expect(
      service.target(actor('teacher-1', UserRole.TEACHER), 'n-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.target(actor('student-1', UserRole.STUDENT), 'n-1'),
    ).resolves.toEqual({
      type: NotificationEntityType.PAYMENT,
      id: 'pay-1',
    });
  });

  it('refuses a draft test and opens a published test of the student course', async () => {
    prisma.notification.findFirst.mockResolvedValue({
      entityType: NotificationEntityType.TEST,
      entityId: 'test-1',
    });
    prisma.theoryTest.findFirst.mockResolvedValue({
      courseId: 'course-1',
      publicationStatus: TheoryTestPublicationStatus.DRAFT,
    });
    await expect(
      service.target(actor('student-1', UserRole.STUDENT), 'n-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    prisma.theoryTest.findFirst.mockResolvedValue({
      courseId: 'course-1',
      publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
    });
    prisma.course.findFirst.mockResolvedValue({
      status: CourseStatus.ACTIVE,
      publicationStatus: CoursePublicationStatus.PUBLISHED,
    });
    prisma.enrollment.findFirst.mockResolvedValue(null);
    await expect(
      service.target(actor('student-1', UserRole.STUDENT), 'n-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    prisma.enrollment.findFirst.mockResolvedValue({ id: 'enroll-1' });
    await expect(
      service.target(actor('student-1', UserRole.STUDENT), 'n-1'),
    ).resolves.toEqual({
      type: NotificationEntityType.TEST,
      id: 'test-1',
    });
  });

  it('opens only the student own test attempt', async () => {
    prisma.notification.findFirst.mockResolvedValue({
      entityType: NotificationEntityType.TEST_ATTEMPT,
      entityId: 'attempt-1',
    });
    prisma.theoryTestAttempt.findFirst.mockResolvedValue({
      studentId: 'student-1',
    });

    await expect(
      service.target(actor('student-2', UserRole.STUDENT), 'n-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.target(actor('student-1', UserRole.STUDENT), 'n-1'),
    ).resolves.toEqual({
      type: NotificationEntityType.TEST_ATTEMPT,
      id: 'attempt-1',
    });
  });
});
