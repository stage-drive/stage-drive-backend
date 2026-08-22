import { createHmac, timingSafeEqual } from 'crypto';

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type TokenPayload = {
  sub: string;
  exp: number;
};

function getSecret(): string {
  return process.env.AUTH_SECRET ?? 'stage-drive-dev-secret';
}

export function signAccessToken(userId: string): string {
  const payload: TokenPayload = {
    sub: userId,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString(
    'base64url',
  );
  const signature = createHmac('sha256', getSecret())
    .update(payloadPart)
    .digest('base64url');
  return `${payloadPart}.${signature}`;
}

export function verifyAccessToken(token: string): TokenPayload {
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

  if (!payload.sub || payload.exp < Date.now()) {
    throw new Error('Invalid token');
  }

  return payload;
}
