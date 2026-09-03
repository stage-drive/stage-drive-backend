import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { OrganizationStatus, UserStatus } from '@prisma/client';

export const INVALID_CREDENTIALS_MESSAGE = 'Invalid credentials';
export const ACCESS_DENIED_MESSAGE =
  'Доступ обмежено. Зверніться до адміністратора за інвайтом.';
export const ACCOUNT_NOT_ACTIVE_MESSAGE =
  'Обліковий запис заблоковано або неактивний.';

export function assertSignInAllowed(user: {
  status: UserStatus;
  deletedAt?: Date | null;
  organization?: { status: OrganizationStatus } | null;
}): void {
  if (
    user.deletedAt ||
    user.status === UserStatus.BLOCKED ||
    user.status === UserStatus.ARCHIVED ||
    user.organization?.status === OrganizationStatus.BLOCKED
  ) {
    throw new ForbiddenException(ACCESS_DENIED_MESSAGE);
  }
}

export function assertActiveUser(user: {
  status: UserStatus;
  deletedAt?: Date | null;
}): void {
  if (user.deletedAt || user.status !== UserStatus.ACTIVE) {
    throw new UnauthorizedException(ACCOUNT_NOT_ACTIVE_MESSAGE);
  }
}
