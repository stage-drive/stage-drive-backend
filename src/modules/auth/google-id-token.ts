import { JWTVerifyGetKey, jwtVerify } from 'jose';

export const GOOGLE_ISSUERS = [
  'https://accounts.google.com',
  'accounts.google.com',
] as const;

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

export class GoogleIdTokenError extends Error {
  constructor() {
    super('Invalid Google ID token');
    this.name = 'GoogleIdTokenError';
  }
}

export type GoogleProfile = {
  sub: string;
  email: string;
  givenName: string;
  familyName: string;
  name: string;
};

function readNamePart(
  value: unknown,
  fallback: string,
  maxLength: number,
): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.slice(0, maxLength);
}

export async function verifyGoogleIdToken(
  idToken: string,
  options: {
    clientId: string;
    nonce: string;
    jwks: JWTVerifyGetKey;
  },
): Promise<GoogleProfile> {
  let payload: Awaited<ReturnType<typeof jwtVerify>>['payload'];
  try {
    const verified = await jwtVerify(idToken, options.jwks, {
      issuer: [...GOOGLE_ISSUERS],
      audience: options.clientId,
      clockTolerance: 30,
    });
    payload = verified.payload;
  } catch {
    throw new GoogleIdTokenError();
  }

  if (payload.nonce !== options.nonce) {
    throw new GoogleIdTokenError();
  }

  if (typeof payload.azp === 'string' && payload.azp !== options.clientId) {
    throw new GoogleIdTokenError();
  }

  if (payload.email_verified !== true) {
    throw new GoogleIdTokenError();
  }

  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new GoogleIdTokenError();
  }

  if (typeof payload.email !== 'string' || !payload.email.trim()) {
    throw new GoogleIdTokenError();
  }

  const givenName = readNamePart(payload.given_name, 'User', 60);
  const familyName = readNamePart(payload.family_name, 'Google', 60);
  const name = readNamePart(payload.name, `${givenName} ${familyName}`, 120);

  return {
    sub: payload.sub,
    email: payload.email.trim().toLowerCase(),
    givenName,
    familyName,
    name,
  };
}
