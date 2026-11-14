import { User, UserRole } from '@prisma/client';

/** Хто веде оплати автошколи: перегляд, створення, редагування, зміна статусу, журнал. */
export const PAYMENT_MANAGE_ROLES = [UserRole.OWNER, UserRole.ADMIN] as const;

/** Хто бачить лише власні оплати. */
export const PAYMENT_SELF_ROLES = [UserRole.STUDENT] as const;

/**
 * Що з оплат студента studentId бачить actor: OWNER і ADMIN — усе ('staff'),
 * сам студент — свої без службового коментаря ('self'), решта (TEACHER,
 * INSTRUCTOR) — нічого ('hidden').
 */
export function paymentVisibility(
  actor: Pick<User, 'id' | 'role'>,
  studentId: string,
): 'staff' | 'self' | 'hidden' {
  if ((PAYMENT_MANAGE_ROLES as readonly UserRole[]).includes(actor.role)) {
    return 'staff';
  }
  if (actor.role === UserRole.STUDENT && actor.id === studentId) {
    return 'self';
  }
  return 'hidden';
}
