import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';

function contextWith(
  roles: UserRole[] | undefined,
  user?: { role: UserRole },
): { context: ExecutionContext; reflector: Reflector } {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(roles),
  } as unknown as Reflector;
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
  return { context, reflector };
}

describe('RolesGuard', () => {
  it('allows any authenticated user when no roles are required', () => {
    const { context, reflector } = contextWith(undefined, {
      role: UserRole.STUDENT,
    });

    expect(new RolesGuard(reflector).canActivate(context)).toBe(true);
  });

  it('allows a user whose role is in the required list', () => {
    const { context, reflector } = contextWith(
      [UserRole.OWNER, UserRole.ADMIN],
      { role: UserRole.ADMIN },
    );

    expect(new RolesGuard(reflector).canActivate(context)).toBe(true);
  });

  it.each([
    UserRole.OWNER,
    UserRole.TEACHER,
    UserRole.INSTRUCTOR,
    UserRole.STUDENT,
  ])('rejects %s when only ADMIN is allowed', (role) => {
    const { context, reflector } = contextWith([UserRole.ADMIN], { role });

    expect(() => new RolesGuard(reflector).canActivate(context)).toThrow(
      ForbiddenException,
    );
  });

  it('rejects a request without a user when roles are required', () => {
    const { context, reflector } = contextWith([UserRole.ADMIN]);

    expect(() => new RolesGuard(reflector).canActivate(context)).toThrow(
      ForbiddenException,
    );
  });
});
