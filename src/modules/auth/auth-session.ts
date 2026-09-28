import { User } from '@prisma/client';
import { RefreshTokenService } from './refresh-token.service';
import { toRegisteredUser } from './registered-user';
import { signAccessToken } from './token';

export type AuthSession = {
  user: ReturnType<typeof toRegisteredUser>;
  accessToken: string;
  refreshToken: string;
};

export async function toAuthSession(
  user: User,
  refreshTokenService: RefreshTokenService,
): Promise<AuthSession> {
  return {
    user: toRegisteredUser(user),
    accessToken: signAccessToken(user.id),
    refreshToken: await refreshTokenService.issue(user.id),
  };
}
