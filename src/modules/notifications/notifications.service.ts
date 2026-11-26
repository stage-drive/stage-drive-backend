import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CoursePublicationStatus,
  CourseStatus,
  EnrollmentStatus,
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
import { isUniqueConstraintOn } from '../../common/prisma/unique-constraint';
import { PrismaService } from '../../prisma/prisma.service';
import { paymentVisibility } from '../payments/payment-roles';
import {
  clipNotificationText,
  formatNotificationWhen,
  NotificationEvent,
  quoteLabel,
} from './notification-events';
import {
  ListNotificationsQueryDto,
  MarkAllNotificationsReadDto,
  NotificationDto,
  NotificationEntityDto,
  NotificationListDto,
  NotificationStatusDto,
  UnreadNotificationCountDto,
} from './notifications.dto';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

const notificationSelect = {
  id: true,
  type: true,
  text: true,
  readStatus: true,
  createdAt: true,
  readAt: true,
  entityType: true,
  entityId: true,
} satisfies Prisma.NotificationSelect;

type NotificationRow = Prisma.NotificationGetPayload<{
  select: typeof notificationSelect;
}>;

type Draft = {
  recipientId: string;
  type: NotificationType;
  text: string;
  dedupeKey: string;
  entityType: NotificationEntityType;
  entityId: string;
};

export const NOTIFICATION_NOT_FOUND_MESSAGE = 'Сповіщення не знайдено.';
export const RELATED_ENTITY_MISSING_MESSAGE =
  'Сповіщення не містить пов’язаної сутності.';
export const RELATED_ENTITY_NOT_FOUND_MESSAGE =
  'Пов’язану сутність не знайдено.';

function toEntity(row: NotificationRow): NotificationEntityDto | null {
  if (!row.entityType || !row.entityId) {
    return null;
  }
  return { type: row.entityType, id: row.entityId };
}

function toDto(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    text: row.text,
    readStatus: row.readStatus,
    createdAt: row.createdAt,
    readAt: row.readAt,
    entity: toEntity(row),
  };
}

/**
 * Створює і зберігає сповіщення на погоджені події розкладу, практики, тестів
 * і оплат. Отримувач завжди належить тій самій автошколі, що й подія.
 * Повтор тієї самої події (той самий dedupeKey) не створює другого рядка.
 * emit не кидає: збій сповіщення не скасовує вже збережену бізнес-операцію.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Запис сповіщень події. Кидає 404, якщо автошколу видалено, і 403, якщо
   * автор події не належить цій автошколі. Чужого отримувача пропускає.
   */
  async record(event: NotificationEvent): Promise<number> {
    const organization = await this.requireOrganization(event.organizationId);
    await this.assertActor(event.organizationId, event.actorId);
    const drafts = await this.drafts(event, organization.timezone);
    const recipientIds = await this.eligibleRecipients(
      event.organizationId,
      event.actorId,
      drafts.map((draft) => draft.recipientId),
      event.kind === 'test.result',
    );
    const allowed = new Set(recipientIds);
    const seen = new Set<string>();
    let created = 0;
    for (const draft of drafts) {
      if (!allowed.has(draft.recipientId) || seen.has(draft.recipientId)) {
        continue;
      }
      seen.add(draft.recipientId);
      if (await this.insert(event.organizationId, draft)) {
        created += 1;
      }
    }
    if (created > 0) {
      this.logger.log(
        `Notifications created kind=${event.kind} count=${created} organizationId=${event.organizationId} actorId=${event.actorId}`,
      );
    }
    return created;
  }

  /** Як record, але помилка лишається в журналі і не доходить до викликача. */
  async emit(event: NotificationEvent): Promise<void> {
    try {
      await this.record(event);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Notification delivery failed kind=${event.kind} organizationId=${event.organizationId} actorId=${event.actorId}: ${message}`,
      );
    }
  }

  /**
   * Свої сповіщення поточної автошколи, від нових до старих.
   * Той самий список годує dropdown (малий limit) і Notification Center (сторінки й фільтр).
   * unreadCount — індикатор на цей момент, навіть якщо сторінка порожня.
   */
  async list(
    actor: User,
    query: ListNotificationsQueryDto = {},
  ): Promise<NotificationListDto> {
    await this.requireOrganization(actor.organizationId);
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const where: Prisma.NotificationWhereInput = {
      organizationId: actor.organizationId,
      recipientId: actor.id,
      ...(query.readStatus ? { readStatus: query.readStatus } : {}),
    };
    const [total, rows, unreadCount] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        select: notificationSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.countUnread(actor.organizationId, actor.id),
    ]);
    return {
      items: rows.map(toDto),
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
      unreadCount,
    };
  }

  async unreadCount(actor: User): Promise<UnreadNotificationCountDto> {
    await this.requireOrganization(actor.organizationId);
    return {
      count: await this.countUnread(actor.organizationId, actor.id),
    };
  }

  /**
   * Позначає своє сповіщення прочитаним. Чуже або з іншої автошколи — 404.
   * Повторний виклик не змінює readAt. unreadCount уже після запису.
   */
  async markRead(
    actor: User,
    notificationId: string,
  ): Promise<NotificationStatusDto> {
    return this.setReadStatus(
      actor,
      notificationId,
      NotificationReadStatus.READ,
    );
  }

  /**
   * Повертає своє сповіщення в непрочитані і прибирає readAt.
   * Повторний виклик нічого не змінює. Чуже сповіщення — 404.
   */
  async markUnread(
    actor: User,
    notificationId: string,
  ): Promise<NotificationStatusDto> {
    return this.setReadStatus(
      actor,
      notificationId,
      NotificationReadStatus.UNREAD,
    );
  }

  /**
   * Позначає всі свої непрочитані прочитаними. Чужі рядки не чіпає.
   * unreadCount читається після запису, тож лічильник уже враховує зміну.
   */
  async markAllRead(actor: User): Promise<MarkAllNotificationsReadDto> {
    await this.requireOrganization(actor.organizationId);
    const now = new Date();
    const updated = await this.prisma.notification.updateMany({
      where: {
        organizationId: actor.organizationId,
        recipientId: actor.id,
        readStatus: NotificationReadStatus.UNREAD,
      },
      data: { readStatus: NotificationReadStatus.READ, readAt: now },
    });
    return {
      updated: updated.count,
      unreadCount: await this.countUnread(actor.organizationId, actor.id),
    };
  }

  /** Своє сповіщення. Чуже або з іншої автошколи для цього запиту не існує. */
  private async setReadStatus(
    actor: User,
    notificationId: string,
    readStatus: NotificationReadStatus,
  ): Promise<NotificationStatusDto> {
    await this.requireOrganization(actor.organizationId);
    const existing = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        organizationId: actor.organizationId,
        recipientId: actor.id,
      },
      select: notificationSelect,
    });
    if (!existing) {
      throw new NotFoundException(NOTIFICATION_NOT_FOUND_MESSAGE);
    }
    const saved =
      existing.readStatus === readStatus
        ? existing
        : await this.prisma.notification.update({
            where: { id: existing.id },
            data:
              readStatus === NotificationReadStatus.READ
                ? { readStatus, readAt: new Date() }
                : { readStatus, readAt: null },
            select: notificationSelect,
          });
    return {
      ...toDto(saved),
      unreadCount: await this.countUnread(actor.organizationId, actor.id),
    };
  }

  private countUnread(organizationId: string, recipientId: string) {
    return this.prisma.notification.count({
      where: {
        organizationId,
        recipientId,
        readStatus: NotificationReadStatus.UNREAD,
      },
    });
  }

  /**
   * Тип і id сутності свого сповіщення, якщо вона ще існує і роль може її відкрити.
   * Чуже сповіщення — 404. Сутності немає або її видалено — 404. Немає прав — 403.
   */
  async target(
    actor: User,
    notificationId: string,
  ): Promise<NotificationEntityDto> {
    await this.requireOrganization(actor.organizationId);
    const notification = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        organizationId: actor.organizationId,
        recipientId: actor.id,
      },
      select: { entityType: true, entityId: true },
    });
    if (!notification) {
      throw new NotFoundException(NOTIFICATION_NOT_FOUND_MESSAGE);
    }
    if (!notification.entityType || !notification.entityId) {
      throw new NotFoundException(RELATED_ENTITY_MISSING_MESSAGE);
    }
    const entity = { type: notification.entityType, id: notification.entityId };
    await this.assertEntityAccess(actor, entity);
    return entity;
  }

  private async drafts(
    event: NotificationEvent,
    timeZone: string,
  ): Promise<Draft[]> {
    const when = (date: Date) => formatNotificationWhen(date, timeZone);
    switch (event.kind) {
      case 'schedule.created':
      case 'schedule.rescheduled':
      case 'schedule.cancelled':
        return this.scheduleDrafts(event, when(event.scheduledAt));
      case 'practice.booked':
      case 'practice.assigned':
      case 'practice.confirmed':
      case 'practice.rejected':
      case 'practice.cancelled':
      case 'practice.rescheduled':
        return this.practiceDrafts(event, when(event.scheduledAt));
      case 'practice.outcome':
        return [
          {
            recipientId: event.studentId,
            type:
              event.outcome === 'COMPLETED'
                ? NotificationType.PRACTICE_COMPLETED
                : NotificationType.PRACTICE_NO_SHOW,
            text:
              event.outcome === 'COMPLETED'
                ? `Практичне заняття ${when(event.scheduledAt)} проведено.`
                : `Зафіксовано неявку на практичне заняття ${when(event.scheduledAt)}.`,
            dedupeKey: `practice:${event.lessonId}:outcome:${event.outcome}`,
            entityType: NotificationEntityType.PRACTICE_LESSON,
            entityId: event.lessonId,
          },
        ];
      case 'test.published':
        return this.publishedTestDrafts(event);
      case 'test.result':
        return this.testResultDrafts(event);
      case 'payment.recorded':
      case 'payment.status_changed':
        return [this.paymentDraft(event)];
    }
  }

  private async scheduleDrafts(
    event: Extract<
      NotificationEvent,
      {
        kind:
          'schedule.created' | 'schedule.rescheduled' | 'schedule.cancelled';
      }
    >,
    when: string,
  ): Promise<Draft[]> {
    const topic = quoteLabel(event.topic);
    const text =
      event.kind === 'schedule.created'
        ? `Заплановано теоретичне заняття «${topic}» на ${when}.`
        : event.kind === 'schedule.rescheduled'
          ? `Теоретичне заняття «${topic}» перенесено на ${when}.`
          : `Теоретичне заняття «${topic}» ${when} скасовано.`;
    const type =
      event.kind === 'schedule.created'
        ? NotificationType.SCHEDULE_CREATED
        : event.kind === 'schedule.rescheduled'
          ? NotificationType.SCHEDULE_RESCHEDULED
          : NotificationType.SCHEDULE_CANCELLED;
    const dedupeKey =
      event.kind === 'schedule.rescheduled'
        ? `schedule:${event.lessonId}:rescheduled:${event.scheduledAt.toISOString()}`
        : `schedule:${event.lessonId}:${event.kind === 'schedule.created' ? 'created' : 'cancelled'}`;
    const recipientIds = await this.scheduleAudience(
      event.organizationId,
      event.groupId,
    );
    return recipientIds.map((recipientId) => ({
      recipientId,
      type,
      text,
      dedupeKey,
      entityType: NotificationEntityType.THEORY_LESSON,
      entityId: event.lessonId,
    }));
  }

  private practiceDrafts(
    event: Extract<
      NotificationEvent,
      {
        kind:
          | 'practice.booked'
          | 'practice.assigned'
          | 'practice.confirmed'
          | 'practice.rejected'
          | 'practice.cancelled'
          | 'practice.rescheduled';
      }
    >,
    when: string,
  ): Draft[] {
    const both = [event.studentId, event.instructorId];
    switch (event.kind) {
      case 'practice.booked':
        return [
          {
            recipientId: event.instructorId,
            type: NotificationType.PRACTICE_BOOKED,
            text: `Новий запит на практичне заняття ${when}. Потрібне підтвердження.`,
            dedupeKey: `practice:${event.lessonId}:booked`,
            entityType: NotificationEntityType.PRACTICE_LESSON,
            entityId: event.lessonId,
          },
        ];
      case 'practice.assigned':
        return both.map((recipientId) => ({
          recipientId,
          type: NotificationType.PRACTICE_ASSIGNED,
          text: `Призначено практичне заняття на ${when}.`,
          dedupeKey: `practice:${event.lessonId}:assigned`,
          entityType: NotificationEntityType.PRACTICE_LESSON,
          entityId: event.lessonId,
        }));
      case 'practice.confirmed':
        return [
          {
            recipientId: event.studentId,
            type: NotificationType.PRACTICE_CONFIRMED,
            text: `Практичне заняття ${when} підтверджено.`,
            dedupeKey: `practice:${event.lessonId}:confirmed`,
            entityType: NotificationEntityType.PRACTICE_LESSON,
            entityId: event.lessonId,
          },
        ];
      case 'practice.rejected':
        return [
          {
            recipientId: event.studentId,
            type: NotificationType.PRACTICE_REJECTED,
            text: `Запит на практичне заняття ${when} відхилено.`,
            dedupeKey: `practice:${event.lessonId}:rejected`,
            entityType: NotificationEntityType.PRACTICE_LESSON,
            entityId: event.lessonId,
          },
        ];
      case 'practice.cancelled':
        return both.map((recipientId) => ({
          recipientId,
          type: NotificationType.PRACTICE_CANCELLED,
          text: `Практичне заняття ${when} скасовано.`,
          dedupeKey: `practice:${event.lessonId}:cancelled`,
          entityType: NotificationEntityType.PRACTICE_LESSON,
          entityId: event.lessonId,
        }));
      case 'practice.rescheduled':
        return both.map((recipientId) => ({
          recipientId,
          type: NotificationType.PRACTICE_RESCHEDULED,
          text: event.awaitingConfirmation
            ? `Практичне заняття перенесено на ${when}. Потрібне підтвердження.`
            : `Практичне заняття перенесено на ${when}.`,
          dedupeKey: `practice:${event.lessonId}:rescheduled:${event.scheduledAt.toISOString()}`,
          entityType: NotificationEntityType.PRACTICE_LESSON,
          entityId: event.lessonId,
        }));
    }
  }

  private async publishedTestDrafts(
    event: Extract<NotificationEvent, { kind: 'test.published' }>,
  ): Promise<Draft[]> {
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        status: EnrollmentStatus.ACTIVE,
        group: {
          organizationId: event.organizationId,
          courseId: event.courseId,
        },
        student: {
          organizationId: event.organizationId,
          deletedAt: null,
          status: UserStatus.ACTIVE,
          role: UserRole.STUDENT,
        },
      },
      select: { studentId: true },
      distinct: ['studentId'],
    });
    return enrollments.map((enrollment) => ({
      recipientId: enrollment.studentId,
      type: NotificationType.TEST_PUBLISHED,
      text: `Опубліковано тест «${quoteLabel(event.name)}».`,
      dedupeKey: `test:${event.testId}:published:${event.publishedAt.toISOString()}`,
      entityType: NotificationEntityType.TEST,
      entityId: event.testId,
    }));
  }

  private async testResultDrafts(
    event: Extract<NotificationEvent, { kind: 'test.result' }>,
  ): Promise<Draft[]> {
    const test = await this.prisma.theoryTest.findFirst({
      where: { id: event.testId, organizationId: event.organizationId },
      select: { name: true },
    });
    const name = quoteLabel(test?.name ?? 'Тест');
    return [
      {
        recipientId: event.studentId,
        type: event.passed
          ? NotificationType.TEST_PASSED
          : NotificationType.TEST_FAILED,
        text: event.passed
          ? `Тест «${name}» складено: ${event.correctCount} з ${event.totalQuestions}.`
          : `Тест «${name}» не складено: ${event.correctCount} з ${event.totalQuestions}.`,
        dedupeKey: `attempt:${event.attemptId}:result`,
        entityType: NotificationEntityType.TEST_ATTEMPT,
        entityId: event.attemptId,
      },
    ];
  }

  private paymentDraft(
    event: Extract<
      NotificationEvent,
      { kind: 'payment.recorded' | 'payment.status_changed' }
    >,
  ): Draft {
    const purpose = quoteLabel(event.purpose);
    const paid = event.status === PaymentStatus.PAID;
    if (event.kind === 'payment.recorded') {
      return {
        recipientId: event.studentId,
        type: NotificationType.PAYMENT_RECORDED,
        text: paid
          ? `Оплату «${purpose}» на суму ${event.amount} ${event.currency} підтверджено.`
          : `Зафіксовано оплату «${purpose}» на суму ${event.amount} ${event.currency}. Статус: не оплачено.`,
        dedupeKey: `payment:${event.paymentId}:recorded`,
        entityType: NotificationEntityType.PAYMENT,
        entityId: event.paymentId,
      };
    }
    return {
      recipientId: event.studentId,
      type: NotificationType.PAYMENT_STATUS_CHANGED,
      text: paid
        ? `Статус оплати «${purpose}» змінено: оплачено (${event.amount} ${event.currency}).`
        : `Статус оплати «${purpose}» змінено: не оплачено.`,
      dedupeKey: `payment:${event.paymentId}:status:${event.status}`,
      entityType: NotificationEntityType.PAYMENT,
      entityId: event.paymentId,
    };
  }

  /** Викладач групи і студенти з активним зарахуванням цієї автошколи. */
  private async scheduleAudience(
    organizationId: string,
    groupId: string,
  ): Promise<string[]> {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, organizationId },
      select: {
        teacher: {
          select: {
            id: true,
            organizationId: true,
            deletedAt: true,
            status: true,
          },
        },
        enrollments: {
          where: {
            status: EnrollmentStatus.ACTIVE,
            student: {
              organizationId,
              deletedAt: null,
              status: UserStatus.ACTIVE,
              role: UserRole.STUDENT,
            },
          },
          select: { studentId: true },
        },
      },
    });
    if (!group) {
      this.logger.warn(
        `Notification audience missing groupId=${groupId} organizationId=${organizationId}`,
      );
      return [];
    }
    const ids = new Set(group.enrollments.map((row) => row.studentId));
    const teacher = group.teacher;
    if (
      teacher.organizationId === organizationId &&
      !teacher.deletedAt &&
      teacher.status === UserStatus.ACTIVE
    ) {
      ids.add(teacher.id);
    } else {
      this.logger.warn(
        `Notification recipient skipped reason=not_in_organization userId=${teacher.id} organizationId=${organizationId}`,
      );
    }
    return [...ids];
  }

  /**
   * Лишає лише активних користувачів цієї автошколи. Автора події не
   * сповіщаємо: він уже знає про свою дію. Виняток — результат тесту,
   * де автор і є студент-отримувач.
   */
  private async eligibleRecipients(
    organizationId: string,
    actorId: string,
    recipientIds: string[],
    includeActor: boolean,
  ): Promise<string[]> {
    const unique = [...new Set(recipientIds)].filter(
      (id) => includeActor || id !== actorId,
    );
    if (unique.length === 0) {
      return [];
    }
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: unique },
        organizationId,
        deletedAt: null,
        status: UserStatus.ACTIVE,
      },
      select: { id: true },
    });
    const allowed = new Set(users.map((user) => user.id));
    for (const id of unique) {
      if (!allowed.has(id)) {
        this.logger.warn(
          `Notification recipient skipped reason=not_in_organization userId=${id} organizationId=${organizationId}`,
        );
      }
    }
    return unique.filter((id) => allowed.has(id));
  }

  /** true — рядок створено. false — та сама подія вже була збережена. */
  private async insert(organizationId: string, draft: Draft): Promise<boolean> {
    const text = clipNotificationText(draft.text);
    if (!text) {
      this.logger.warn(
        `Notification skipped reason=empty_text organizationId=${organizationId} recipientId=${draft.recipientId}`,
      );
      return false;
    }
    try {
      await this.prisma.notification.create({
        data: {
          organizationId,
          recipientId: draft.recipientId,
          type: draft.type,
          text,
          readStatus: NotificationReadStatus.UNREAD,
          dedupeKey: draft.dedupeKey,
          entityType: draft.entityType,
          entityId: draft.entityId,
        },
      });
      return true;
    } catch (error) {
      if (isUniqueConstraintOn(error, 'dedupeKey')) {
        this.logger.log(
          `Notification duplicate skipped dedupeKey=${draft.dedupeKey} recipientId=${draft.recipientId} organizationId=${organizationId}`,
        );
        return false;
      }
      throw error;
    }
  }

  /** 403, коли рядок сутності є, але ця роль його не відкриває. */
  private denyTarget(actor: User, reason: string): never {
    this.logger.warn(
      `Notification target denied reason=${reason} actorId=${actor.id} organizationId=${actor.organizationId}`,
    );
    throw new ForbiddenException('Insufficient permissions');
  }

  private async assertEntityAccess(
    actor: User,
    entity: NotificationEntityDto,
  ): Promise<void> {
    switch (entity.type) {
      case NotificationEntityType.THEORY_LESSON:
        return this.assertTheoryLesson(actor, entity.id);
      case NotificationEntityType.PRACTICE_LESSON:
        return this.assertPracticeLesson(actor, entity.id);
      case NotificationEntityType.TEST:
        return this.assertTest(actor, entity.id);
      case NotificationEntityType.TEST_ATTEMPT:
        return this.assertTestAttempt(actor, entity.id);
      case NotificationEntityType.PAYMENT:
        return this.assertPayment(actor, entity.id);
    }
  }

  /**
   * Те саме коло, що бачить заняття в розкладі: ADMIN — будь-яке своєї автошколи,
   * TEACHER — своєї групи, STUDENT — групи зі своїм зарахуванням.
   * Завершене зарахування лишає лише історію, як у персональному розкладі.
   */
  private async assertTheoryLesson(
    actor: User,
    lessonId: string,
  ): Promise<void> {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, organizationId: actor.organizationId },
      select: {
        groupId: true,
        scheduledAt: true,
        group: { select: { teacherId: true } },
      },
    });
    if (!lesson) {
      throw new NotFoundException(RELATED_ENTITY_NOT_FOUND_MESSAGE);
    }
    if (actor.role === UserRole.ADMIN) {
      return;
    }
    if (actor.role === UserRole.TEACHER) {
      if (lesson.group.teacherId !== actor.id) {
        this.denyTarget(actor, 'theory_lesson');
      }
      return;
    }
    if (actor.role === UserRole.STUDENT) {
      const statuses =
        lesson.scheduledAt.getTime() <= Date.now()
          ? [EnrollmentStatus.ACTIVE, EnrollmentStatus.COMPLETED]
          : [EnrollmentStatus.ACTIVE];
      const enrollment = await this.prisma.enrollment.findFirst({
        where: {
          studentId: actor.id,
          groupId: lesson.groupId,
          status: { in: statuses },
        },
        select: { id: true },
      });
      if (!enrollment) {
        this.denyTarget(actor, 'theory_lesson');
      }
      return;
    }
    this.denyTarget(actor, 'theory_lesson');
  }

  /** ADMIN — будь-яке практичне своєї автошколи, INSTRUCTOR і STUDENT — лише своє. */
  private async assertPracticeLesson(
    actor: User,
    lessonId: string,
  ): Promise<void> {
    const lesson = await this.prisma.drivingLesson.findFirst({
      where: { id: lessonId, organizationId: actor.organizationId },
      select: { studentId: true, instructorId: true },
    });
    if (!lesson) {
      throw new NotFoundException(RELATED_ENTITY_NOT_FOUND_MESSAGE);
    }
    if (actor.role === UserRole.ADMIN) {
      return;
    }
    if (
      actor.role === UserRole.INSTRUCTOR &&
      lesson.instructorId === actor.id
    ) {
      return;
    }
    if (actor.role === UserRole.STUDENT && lesson.studentId === actor.id) {
      return;
    }
    this.denyTarget(actor, 'practice_lesson');
  }

  /**
   * ADMIN — будь-який тест автошколи. TEACHER — тест курсу своєї групи.
   * STUDENT — лише опублікований тест опублікованого активного курсу,
   * до якого є активне зарахування.
   */
  private async assertTest(actor: User, testId: string): Promise<void> {
    const test = await this.prisma.theoryTest.findFirst({
      where: { id: testId, organizationId: actor.organizationId },
      select: { courseId: true, publicationStatus: true },
    });
    if (!test) {
      throw new NotFoundException(RELATED_ENTITY_NOT_FOUND_MESSAGE);
    }
    if (actor.role === UserRole.ADMIN) {
      return;
    }
    if (actor.role === UserRole.TEACHER) {
      const group = await this.prisma.group.findFirst({
        where: {
          organizationId: actor.organizationId,
          teacherId: actor.id,
          courseId: test.courseId,
        },
        select: { id: true },
      });
      if (!group) {
        this.denyTarget(actor, 'test');
      }
      return;
    }
    if (actor.role !== UserRole.STUDENT) {
      this.denyTarget(actor, 'test');
    }
    if (test.publicationStatus !== TheoryTestPublicationStatus.PUBLISHED) {
      this.denyTarget(actor, 'test_not_published');
    }
    const course = await this.prisma.course.findFirst({
      where: { id: test.courseId, organizationId: actor.organizationId },
      select: { status: true, publicationStatus: true },
    });
    if (
      !course ||
      course.status !== CourseStatus.ACTIVE ||
      course.publicationStatus !== CoursePublicationStatus.PUBLISHED
    ) {
      this.denyTarget(actor, 'test_course');
    }
    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        studentId: actor.id,
        status: EnrollmentStatus.ACTIVE,
        group: {
          organizationId: actor.organizationId,
          courseId: test.courseId,
        },
      },
      select: { id: true },
    });
    if (!enrollment) {
      this.denyTarget(actor, 'test');
    }
  }

  /** Спробу відкриває лише студент, який її проходив. */
  private async assertTestAttempt(
    actor: User,
    attemptId: string,
  ): Promise<void> {
    const attempt = await this.prisma.theoryTestAttempt.findFirst({
      where: { id: attemptId, organizationId: actor.organizationId },
      select: { studentId: true },
    });
    if (!attempt) {
      throw new NotFoundException(RELATED_ENTITY_NOT_FOUND_MESSAGE);
    }
    if (actor.role === UserRole.STUDENT && attempt.studentId === actor.id) {
      return;
    }
    this.denyTarget(actor, 'test_attempt');
  }

  /** OWNER і ADMIN бачать оплату автошколи, студент — лише свою. */
  private async assertPayment(actor: User, paymentId: string): Promise<void> {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, organizationId: actor.organizationId },
      select: { studentId: true },
    });
    if (!payment) {
      throw new NotFoundException(RELATED_ENTITY_NOT_FOUND_MESSAGE);
    }
    if (paymentVisibility(actor, payment.studentId) === 'hidden') {
      this.denyTarget(actor, 'payment');
    }
  }

  private async assertActor(
    organizationId: string,
    actorId: string,
  ): Promise<void> {
    const actor = await this.prisma.user.findFirst({
      where: { id: actorId, deletedAt: null },
      select: { organizationId: true },
    });
    if (!actor || actor.organizationId !== organizationId) {
      this.logger.warn(
        `Notification access denied reason=organization actorId=${actorId} organizationId=${organizationId}`,
      );
      throw new ForbiddenException('Insufficient permissions');
    }
  }

  private async requireOrganization(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, deletedAt: true, timezone: true },
    });
    if (!organization || organization.deletedAt) {
      throw new NotFoundException('Organization not found');
    }
    return organization;
  }
}
