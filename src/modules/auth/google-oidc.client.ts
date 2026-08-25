import { Injectable } from '@nestjs/common';
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
    } catch {
      throw new GoogleIdTokenError();
    }

    let data: { id_token?: string } = {};
    try {
      data = (await response.json()) as { id_token?: string };
    } catch {
      throw new GoogleIdTokenError();
    }

    if (!response.ok || typeof data.id_token !== 'string' || !data.id_token) {
      throw new GoogleIdTokenError();
    }

    return data.id_token;
  }

  async verifyIdToken(idToken: string, nonce: string): Promise<GoogleProfile> {
    return verifyGoogleIdToken(idToken, {
      clientId: this.config.clientId,
      nonce,
      jwks: this.jwks,
    });
  }
}
