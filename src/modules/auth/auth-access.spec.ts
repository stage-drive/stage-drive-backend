import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { OrganizationStatus, UserStatus } from '@prisma/client';
import {
  ACCESS_DENIED_MESSAGE,
  ACCOUNT_NOT_ACTIVE_MESSAGE,
  assertActiveUser,
  assertSignInAllowed,
} from './auth-access';

const activeOrganization = {
  status: OrganizationStatus.ACTIVE,
  deletedAt: null,
};

function user(
  organization: { status: OrganizationStatus; deletedAt: Date | null } | null,
) {
  return {
    status: UserStatus.ACTIVE,
    deletedAt: null,
    organization,
  };
}

describe('assertSignInAllowed', () => {
  it('allows an active user of an active organization', () => {
    expect(() => assertSignInAllowed(user(activeOrganization))).not.toThrow();
  });

  it('rejects a user of a blocked organization', () => {
    expect(() =>
      assertSignInAllowed(
        user({ status: OrganizationStatus.BLOCKED, deletedAt: null }),
      ),
    ).toThrow(new ForbiddenException(ACCESS_DENIED_MESSAGE));
  });

  it('rejects a user of a deleted organization', () => {
    expect(() =>
      assertSignInAllowed(
        user({ ...activeOrganization, deletedAt: new Date('2026-11-01') }),
      ),
    ).toThrow(new ForbiddenException(ACCESS_DENIED_MESSAGE));
  });
});

describe('assertActiveUser', () => {
  it('allows an active user of an active organization', () => {
    expect(() => assertActiveUser(user(activeOrganization))).not.toThrow();
  });

  it('rejects a user of a blocked organization', () => {
    expect(() =>
      assertActiveUser(
        user({ status: OrganizationStatus.BLOCKED, deletedAt: null }),
      ),
    ).toThrow(new UnauthorizedException(ACCOUNT_NOT_ACTIVE_MESSAGE));
  });

  it('rejects a user of a deleted organization', () => {
    expect(() =>
      assertActiveUser(
        user({ ...activeOrganization, deletedAt: new Date('2026-11-01') }),
      ),
    ).toThrow(new UnauthorizedException(ACCOUNT_NOT_ACTIVE_MESSAGE));
  });
});
