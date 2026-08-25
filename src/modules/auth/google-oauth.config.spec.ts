import { GoogleOAuthConfig } from './google-oauth.config';

const REQUIRED = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'GOOGLE_OAUTH_SUCCESS_REDIRECT',
] as const;

describe('GoogleOAuthConfig', () => {
  const original: Partial<
    Record<(typeof REQUIRED)[number], string | undefined>
  > = {};

  beforeAll(() => {
    for (const key of REQUIRED) {
      original[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of REQUIRED) {
      const value = original[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('reads required Google variables at construction', () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    process.env.GOOGLE_REDIRECT_URI =
      'http://localhost:3000/api/auth/google/callback';
    delete process.env.GOOGLE_OAUTH_SUCCESS_REDIRECT;

    const config = new GoogleOAuthConfig();

    expect(config.enabled).toBe(true);
    expect(config.clientId).toBe('client-id');
    expect(config.clientSecret).toBe('client-secret');
    expect(config.redirectUri).toBe(
      'http://localhost:3000/api/auth/google/callback',
    );
    expect(config.successRedirect).toBeNull();
  });

  it('starts with Google disabled when no Google variables are set', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
    delete process.env.GOOGLE_OAUTH_SUCCESS_REDIRECT;

    const config = new GoogleOAuthConfig();

    expect(config.enabled).toBe(false);
  });

  it('fails startup when Google config is only partially set', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    process.env.GOOGLE_REDIRECT_URI =
      'http://localhost:3000/api/auth/google/callback';

    expect(() => new GoogleOAuthConfig()).toThrow(
      'Missing required environment variable GOOGLE_CLIENT_ID',
    );
  });
});
