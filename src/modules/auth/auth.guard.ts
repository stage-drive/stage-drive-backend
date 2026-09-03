import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { assertActiveUser } from './auth-access';
import { TokenPayload, verifyAccessToken } from './token';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    let payload: TokenPayload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    assertActiveUser(user);

    if (
      user.tokensInvalidBefore &&
      payload.iat < user.tokensInvalidBefore.getTime()
    ) {
      throw new UnauthorizedException('Access token revoked');
    }

    request.user = user;
    return true;
  }
}
