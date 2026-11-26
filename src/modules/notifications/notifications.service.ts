import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EnrollmentStatus,
  NotificationReadStatus,
  NotificationType,
  PaymentStatus,
  Prisma,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { isUniqueConstraintOn } from '../../common/prisma/unique-constraint';
import { PrismaService } from '../../prisma/prisma.service';
import {
  clipNotificationText,
  formatNotificationWhen,
  NotificationEvent,
  quoteLabel,
} from './notification-events';
import {
  ListNotificationsQueryDto,
  NotificationDto,
  NotificationListDto,
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
} satisfies Prisma.NotificationSelect;

type NotificationRow = Prisma.NotificationGetPayload<{
  select: typeof notificationSelect;
}>;

type Draft = {
  recipientId: string;
  type: NotificationType;
  text: string;
  dedupeKey: string;
};

export const NOTIFICATION_NOT_FOUND_MESSAGE = 'Сповіщення не знайдено.';

function toDto(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    text: row.text,
    readStatus: row.readStatus,
    createdAt: row.createdAt,
    readAt: row.readAt,
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

  /** Свої сповіщення поточної автошколи, від нових до старих. */
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
    const [total, rows] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        select: notificationSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      items: rows.map(toDto),
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async unreadCount(actor: User): Promise<UnreadNotificationCountDto> {
    await this.requireOrganization(actor.organizationId);
    const count = await this.prisma.notification.count({
      where: {
        organizationId: actor.organizationId,
        recipientId: actor.id,
        readStatus: NotificationReadStatus.UNREAD,
      },
    });
    return { count };
  }

  /**
   * Позначає своє сповіщення прочитаним. Чуже або з іншої автошколи — 404.
   * Повторний виклик не змінює readAt.
   */
  async markRead(
    actor: User,
    notificationId: string,
  ): Promise<NotificationDto> {
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
    if (existing.readStatus === NotificationReadStatus.READ) {
      return toDto(existing);
    }
    const saved = await this.prisma.notification.update({
      where: { id: existing.id },
      data: { readStatus: NotificationReadStatus.READ, readAt: new Date() },
      select: notificationSelect,
    });
    return toDto(saved);
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
          },
        ];
      case 'practice.assigned':
        return both.map((recipientId) => ({
          recipientId,
          type: NotificationType.PRACTICE_ASSIGNED,
          text: `Призначено практичне заняття на ${when}.`,
          dedupeKey: `practice:${event.lessonId}:assigned`,
        }));
      case 'practice.confirmed':
        return [
          {
            recipientId: event.studentId,
            type: NotificationType.PRACTICE_CONFIRMED,
            text: `Практичне заняття ${when} підтверджено.`,
            dedupeKey: `practice:${event.lessonId}:confirmed`,
          },
        ];
      case 'practice.rejected':
        return [
          {
            recipientId: event.studentId,
            type: NotificationType.PRACTICE_REJECTED,
            text: `Запит на практичне заняття ${when} відхилено.`,
            dedupeKey: `practice:${event.lessonId}:rejected`,
          },
        ];
      case 'practice.cancelled':
        return both.map((recipientId) => ({
          recipientId,
          type: NotificationType.PRACTICE_CANCELLED,
          text: `Практичне заняття ${when} скасовано.`,
          dedupeKey: `practice:${event.lessonId}:cancelled`,
        }));
      case 'practice.rescheduled':
        return both.map((recipientId) => ({
          recipientId,
          type: NotificationType.PRACTICE_RESCHEDULED,
          text: event.awaitingConfirmation
            ? `Практичне заняття перенесено на ${when}. Потрібне підтвердження.`
            : `Практичне заняття перенесено на ${when}.`,
          dedupeKey: `practice:${event.lessonId}:rescheduled:${event.scheduledAt.toISOString()}`,
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
      dedupeKey: `test:${event.testId}:published`,
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
      };
    }
    return {
      recipientId: event.studentId,
      type: NotificationType.PAYMENT_STATUS_CHANGED,
      text: paid
        ? `Статус оплати «${purpose}» змінено: оплачено (${event.amount} ${event.currency}).`
        : `Статус оплати «${purpose}» змінено: не оплачено.`,
      dedupeKey: `payment:${event.paymentId}:status:${event.status}`,
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
