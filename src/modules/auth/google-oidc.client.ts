import { Injectable, Logger } from '@nestjs/common';
import { createRemoteJWKSet } from 'jose';
import {
  GOOGLE_JWKS_URL,
  GoogleIdTokenError,
  GoogleProfile,
  verifyGoogleIdToken,
} from './google-id-token';
import { GoogleOAuthConfig } from './google-oauth.config';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

@Injectable()
export class GoogleOidcClient {
  private readonly logger = new Logger(GoogleOidcClient.name);
  private readonly jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));

  constructor(private readonly config: GoogleOAuthConfig) {}

  async exchangeCode(code: string, codeVerifier: string): Promise<string> {
    const body = new URLSearchParams({
      code,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    });

    let response: Response;
    try {
      response = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch (error) {
      this.logger.warn(
        `Google token request failed: ${error instanceof Error ? error.message : 'network error'}`,
      );
      throw new GoogleIdTokenError('Invalid Google ID token (token network)');
    }

    let data: {
      id_token?: string;
      error?: string;
      error_description?: string;
    } = {};
    try {
      data = (await response.json()) as typeof data;
    } catch {
      this.logger.warn(
        `Google token response was not JSON (HTTP ${response.status})`,
      );
      throw new GoogleIdTokenError('Invalid Google ID token (token json)');
    }

    if (!response.ok || typeof data.id_token !== 'string' || !data.id_token) {
      this.logger.warn(
        `Google token exchange failed: HTTP ${response.status} error=${data.error ?? 'none'} desc=${data.error_description ?? 'none'}`,
      );
      throw new GoogleIdTokenError('Invalid Google ID token (token exchange)');
    }

    return data.id_token;
  }

  async verifyIdToken(
    idToken: string,
    nonce?: string,
  ): Promise<GoogleProfile> {
    return verifyGoogleIdToken(idToken, {
      clientId: this.config.clientId,
      nonce,
      jwks: this.jwks,
    });
  }
}
