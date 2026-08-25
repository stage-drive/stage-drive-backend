import { User } from '@prisma/client';
import { signAccessToken, signRefreshToken } from './token';

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

export function toAuthSession(user: User): AuthSession {
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
    refreshToken: signRefreshToken(user.id),
  };
}
