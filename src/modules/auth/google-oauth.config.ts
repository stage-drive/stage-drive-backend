import { Injectable } from '@nestjs/common';

const REQUIRED_GOOGLE_ENV = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
] as const;

function readEnv(name: string): string {
  return process.env[name]?.trim() ?? '';
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
    const redirectUri = readEnv('GOOGLE_REDIRECT_URI');
    const present = [clientId, clientSecret, redirectUri].filter(Boolean);

    if (present.length === 0) {
      this.enabled = false;
      this.clientId = '';
      this.clientSecret = '';
      this.redirectUri = '';
      this.successRedirect = null;
      return;
    }

    if (present.length < REQUIRED_GOOGLE_ENV.length) {
      const missing = REQUIRED_GOOGLE_ENV.filter((name) => !readEnv(name));
      throw new Error(
        `Missing required environment variable ${missing.join(', ')}`,
      );
    }

    this.enabled = true;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.successRedirect =
      process.env.GOOGLE_OAUTH_SUCCESS_REDIRECT?.trim() || null;
  }
}
