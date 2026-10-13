const DEFAULT_FRONTEND_URL = 'http://localhost:5173';

/** Base URL of the frontend for links in emails, without a trailing slash. */
export function frontendBaseUrl(): string {
  const fromEnv = (
    process.env.FRONTEND_URL ??
    process.env.GOOGLE_OAUTH_SUCCESS_REDIRECT ??
    DEFAULT_FRONTEND_URL
  ).trim();
  return (fromEnv || DEFAULT_FRONTEND_URL).replace(/\/$/, '');
}
