import { Injectable } from '@nestjs/common';

const DEFAULT_REDIRECT_URI = 'http://localhost:3000/api/auth/google/callback';

function readEnv(key: string): string {
  return (process.env[key] ?? '').trim();
}

@Injectable()
export class GoogleOAuthConfig {
  readonly enabled: boolean;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly successRedirect: string | null;

  constructor() {
    const clientId = readEnv('GOOGLE_CLIENT_ID');
    const clientSecret = readEnv('GOOGLE_CLIENT_SECRET');
    const hasCredentials = Boolean(clientId || clientSecret);

    if (!hasCredentials) {
      this.enabled = false;
      this.clientId = '';
      this.clientSecret = '';
      this.redirectUri = '';
      this.successRedirect = null;
      return;
    }

    if (!clientId || !clientSecret) {
      const missing = [
        !clientId ? 'GOOGLE_CLIENT_ID' : '',
        !clientSecret ? 'GOOGLE_CLIENT_SECRET' : '',
      ].filter(Boolean);
      throw new Error(
        `Missing required environment variable ${missing.join(', ')}`,
      );
    }

    this.enabled = true;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = readEnv('GOOGLE_REDIRECT_URI') || DEFAULT_REDIRECT_URI;
    this.successRedirect = readEnv('GOOGLE_OAUTH_SUCCESS_REDIRECT') || null;
  }
}
