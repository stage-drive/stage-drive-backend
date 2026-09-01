import { ForbiddenException } from '@nestjs/common';
import { OrganizationStatus, UserStatus } from '@prisma/client';

export const INVALID_CREDENTIALS_MESSAGE = 'Invalid credentials';
export const ACCESS_DENIED_MESSAGE =
  'Доступ обмежено. Зверніться до адміністратора за інвайтом.';

export function assertSignInAllowed(user: {
  status: UserStatus;
  organization?: { status: OrganizationStatus } | null;
}): void {
  if (
    user.status === UserStatus.BLOCKED ||
    user.status === UserStatus.ARCHIVED ||
    user.organization?.status === OrganizationStatus.BLOCKED
  ) {
    throw new ForbiddenException(ACCESS_DENIED_MESSAGE);
  }
}
