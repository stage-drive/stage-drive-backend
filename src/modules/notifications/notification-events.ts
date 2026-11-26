import { PaymentStatus } from '@prisma/client';

/** Погоджена бізнес-подія, з якої треба створити сповіщення. */
export type NotificationEvent =
  | ScheduleEvent
  | PracticeEvent
  | PracticeOutcomeEvent
  | TestPublishedEvent
  | TestResultEvent
  | PaymentEvent;

type ScheduleEvent = {
  kind: 'schedule.created' | 'schedule.rescheduled' | 'schedule.cancelled';
  organizationId: string;
  actorId: string;
  lessonId: string;
  groupId: string;
  topic: string;
  scheduledAt: Date;
};

type PracticeEvent = {
  kind:
    | 'practice.booked'
    | 'practice.assigned'
    | 'practice.confirmed'
    | 'practice.rejected'
    | 'practice.cancelled'
    | 'practice.rescheduled';
  organizationId: string;
  actorId: string;
  lessonId: string;
  studentId: string;
  instructorId: string;
  scheduledAt: Date;
  /** Перенесення студентом знову чекає підтвердження інструктора. */
  awaitingConfirmation?: boolean;
};

type PracticeOutcomeEvent = {
  kind: 'practice.outcome';
  organizationId: string;
  actorId: string;
  lessonId: string;
  studentId: string;
  scheduledAt: Date;
  outcome: 'COMPLETED' | 'NO_SHOW';
};

type TestPublishedEvent = {
  kind: 'test.published';
  organizationId: string;
  actorId: string;
  testId: string;
  courseId: string;
  name: string;
  /** Момент цієї публікації. Повтор того самого запиту не створює другого сповіщення, нова публікація — створює. */
  publishedAt: Date;
};

type TestResultEvent = {
  kind: 'test.result';
  organizationId: string;
  actorId: string;
  studentId: string;
  attemptId: string;
  testId: string;
  passed: boolean;
  correctCount: number;
  totalQuestions: number;
};

type PaymentEvent = {
  kind: 'payment.recorded' | 'payment.status_changed';
  organizationId: string;
  actorId: string;
  paymentId: string;
  studentId: string;
  status: PaymentStatus;
  purpose: string;
  amount: string;
  currency: string;
};

const TEXT_MAX = 500;

/** Місцевий час автошколи в тексті сповіщення. */
export function formatNotificationWhen(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('uk-UA', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Один пробіл і межа колонки text. */
export function clipNotificationText(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > TEXT_MAX ? clean.slice(0, TEXT_MAX) : clean;
}

export function quoteLabel(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > 0 ? clean : '—';
}
