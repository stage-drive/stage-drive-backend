import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { Request } from 'express';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;
    if (!user || !roles.includes(user.role)) {
      // Журнал невдалих спроб доступу; ні тіла, ні query запиту не пишемо.
      this.logger.warn(
        `Access denied method=${request.method} path=${request.path} userId=${user?.id ?? 'none'} role=${user?.role ?? 'none'} organizationId=${user?.organizationId ?? 'none'}`,
      );
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
