import { randomBytes } from 'crypto';
import { AuthModule } from './auth.module';

describe('AuthModule startup', () => {
  const originalSecret = process.env.AUTH_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = originalSecret;
    }
  });

  it('starts with a strong AUTH_SECRET', () => {
    process.env.AUTH_SECRET = randomBytes(32).toString('base64');

    expect(() => new AuthModule().onModuleInit()).not.toThrow();
  });

  it.each([
    ['missing', undefined],
    ['too short', 'short-secret'],
    ['the old docker-compose fallback', 'stage-drive-dev-secret'],
    ['the old .env.example value', 'change-me-in-production'],
  ])('refuses to start when AUTH_SECRET is %s', (_label, value) => {
    if (value === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = value;
    }

    expect(() => new AuthModule().onModuleInit()).toThrow(/AUTH_SECRET/);
  });
});
