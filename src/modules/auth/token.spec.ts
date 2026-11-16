import { createHmac, randomBytes } from 'crypto';
import {
  signAccessToken,
  tryGetAccessTokenUserId,
  verifyAccessToken,
} from './token';

describe('access token signing and AUTH_SECRET', () => {
  const originalSecret = process.env.AUTH_SECRET;
  const strongSecret = randomBytes(32).toString('base64');

  beforeEach(() => {
    process.env.AUTH_SECRET = strongSecret;
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = originalSecret;
    }
  });

  it('signs and verifies a token with a strong secret', () => {
    const token = signAccessToken('user-1');

    expect(verifyAccessToken(token).sub).toBe('user-1');
  });

  it('rejects a token signed with a different secret', () => {
    const token = signAccessToken('user-1');
    process.env.AUTH_SECRET = randomBytes(32).toString('base64');

    expect(() => verifyAccessToken(token)).toThrow('Invalid token');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['too short', 'short-secret'],
    ['a former default', 'stage-drive-dev-secret'],
    ['a placeholder', 'change-me-in-production-change-me-in-production'],
  ])('refuses to sign when AUTH_SECRET is %s (no silent fallback)', (_l, v) => {
    if (v === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = v;
    }

    expect(() => signAccessToken('user-1')).toThrow(/AUTH_SECRET/);
  });

  it('refuses to verify when AUTH_SECRET is missing, instead of using a default key', () => {
    const token = signAccessToken('user-1');
    delete process.env.AUTH_SECRET;

    expect(() => verifyAccessToken(token)).toThrow(/AUTH_SECRET is not set/);
  });

  it('rejects a token forged with the old docker-compose fallback key', () => {
    // What an attacker who read the old `${AUTH_SECRET:-stage-drive-dev-secret}` would do.
    const now = Date.now();
    const payload = Buffer.from(
      JSON.stringify({ sub: 'user-1', iat: now, exp: now + 60_000 }),
    ).toString('base64url');
    const signature = createHmac('sha256', 'stage-drive-dev-secret')
      .update(payload)
      .digest('base64url');
    const forged = `${payload}.${signature}`;

    expect(() => verifyAccessToken(forged)).toThrow('Invalid token');
    expect(tryGetAccessTokenUserId(`Bearer ${forged}`)).toBeUndefined();
  });
});
