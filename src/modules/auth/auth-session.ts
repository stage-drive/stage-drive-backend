import { User } from '@prisma/client';
import { RefreshTokenService } from './refresh-token.service';
import { signAccessToken } from './token';

export type AuthSession = {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: User['role'];
    status: string;
    organizationId: string;
  };
  accessToken: string;
  refreshToken: string;
};

export async function toAuthSession(
  user: User,
  refreshTokenService: RefreshTokenService,
): Promise<AuthSession> {
  return {
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      status: user.status,
      organizationId: user.organizationId,
    },
    accessToken: signAccessToken(user.id),
    refreshToken: await refreshTokenService.issue(user.id),
  };
}
