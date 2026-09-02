import { createHmac, timingSafeEqual } from 'crypto';
import { requireEnv } from '../../common/config/env';

const ACCESS_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type TokenType = 'access' | 'refresh';

export type TokenPayload = {
  sub: string;
  type: TokenType;
  exp: number;
};

function getSecret(): string {
  return requireEnv('AUTH_SECRET');
}

function sign(userId: string, type: TokenType, ttlMs: number): string {
  const payload: TokenPayload = {
    sub: userId,
    type,
    exp: Date.now() + ttlMs,
  };
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString(
    'base64url',
  );
  const signature = createHmac('sha256', getSecret())
    .update(payloadPart)
    .digest('base64url');
  return `${payloadPart}.${signature}`;
}

function verify(token: string): TokenPayload {
  const [payloadPart, signature] = token.split('.');
  if (!payloadPart || !signature) {
    throw new Error('Invalid token');
  }

  const expected = createHmac('sha256', getSecret())
    .update(payloadPart)
    .digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error('Invalid token');
  }

  const payload = JSON.parse(
    Buffer.from(payloadPart, 'base64url').toString('utf8'),
  ) as TokenPayload;

  if (!payload.sub || !payload.type || payload.exp < Date.now()) {
    throw new Error('Invalid token');
  }

  return payload;
}

export function signAccessToken(userId: string): string {
  return sign(userId, 'access', ACCESS_TOKEN_TTL_MS);
}

export function signRefreshToken(userId: string): string {
  return sign(userId, 'refresh', REFRESH_TOKEN_TTL_MS);
}

export function tryGetAccessTokenUserId(
  authorization?: string,
): string | undefined {
  if (!authorization?.startsWith('Bearer ')) {
    return undefined;
  }
  try {
    return verifyAccessToken(authorization.slice(7)).sub;
  } catch {
    return undefined;
  }
}

export function verifyAccessToken(token: string): TokenPayload {
  const payload = verify(token);
  if (payload.type !== 'access') {
    throw new Error('Invalid token type');
  }
  return payload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  const payload = verify(token);
  if (payload.type !== 'refresh') {
    throw new Error('Invalid token type');
  }
  return payload;
}
