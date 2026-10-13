import { frontendBaseUrl } from './frontend-url';

describe('frontendBaseUrl', () => {
  const originalFrontendUrl = process.env.FRONTEND_URL;
  const originalOAuthRedirect = process.env.GOOGLE_OAUTH_SUCCESS_REDIRECT;

  function setEnv(frontendUrl?: string, oauthRedirect?: string) {
    if (frontendUrl === undefined) {
      delete process.env.FRONTEND_URL;
    } else {
      process.env.FRONTEND_URL = frontendUrl;
    }
    if (oauthRedirect === undefined) {
      delete process.env.GOOGLE_OAUTH_SUCCESS_REDIRECT;
    } else {
      process.env.GOOGLE_OAUTH_SUCCESS_REDIRECT = oauthRedirect;
    }
  }

  afterEach(() => {
    setEnv(originalFrontendUrl, originalOAuthRedirect);
  });

  it('uses FRONTEND_URL without the trailing slash', () => {
    setEnv(' https://app.example.com/ ', 'https://oauth.example.com');

    expect(frontendBaseUrl()).toBe('https://app.example.com');
  });

  it('falls back to GOOGLE_OAUTH_SUCCESS_REDIRECT when FRONTEND_URL is unset', () => {
    setEnv(undefined, 'https://oauth.example.com');

    expect(frontendBaseUrl()).toBe('https://oauth.example.com');
  });

  it('falls back to the local Vite URL when nothing is configured', () => {
    setEnv(undefined, undefined);

    expect(frontendBaseUrl()).toBe('http://localhost:5173');
  });

  it('treats a blank FRONTEND_URL as unconfigured', () => {
    setEnv('   ', 'https://oauth.example.com');

    expect(frontendBaseUrl()).toBe('http://localhost:5173');
  });
});
