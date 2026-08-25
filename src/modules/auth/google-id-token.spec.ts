import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { verifyGoogleIdToken } from './google-id-token';

const CLIENT_ID = 'test-google-client-id';
const NONCE = 'test-nonce';

async function signedIdToken(
  privateKey: CryptoKey,
  claims: Record<string, unknown> = {},
  options?: {
    audience?: string;
    issuer?: string;
    subject?: string;
    expiresIn?: string | number;
    kid?: string;
  },
) {
  return new SignJWT({
    email: 'ada@gmail.com',
    email_verified: true,
    nonce: NONCE,
    given_name: 'Ada',
    family_name: 'Lovelace',
    name: 'Ada Lovelace',
    azp: CLIENT_ID,
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: options?.kid ?? 'test-kid' })
    .setIssuer(options?.issuer ?? 'https://accounts.google.com')
    .setAudience(options?.audience ?? CLIENT_ID)
    .setSubject(options?.subject ?? 'google-sub-1')
    .setExpirationTime(options?.expiresIn ?? '1h')
    .sign(privateKey);
}

describe('verifyGoogleIdToken', () => {
  let privateKey: CryptoKey;
  let jwks: ReturnType<typeof createLocalJWKSet>;

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    const jwk = await exportJWK(pair.publicKey);
    jwk.kid = 'test-kid';
    jwk.alg = 'RS256';
    jwks = createLocalJWKSet({ keys: [jwk] });
  });

  async function verify(token: string, nonce = NONCE) {
    return verifyGoogleIdToken(token, { clientId: CLIENT_ID, nonce, jwks });
  }

  it('accepts a valid Google ID token', async () => {
    const token = await signedIdToken(privateKey);
    await expect(verify(token)).resolves.toMatchObject({
      sub: 'google-sub-1',
      email: 'ada@gmail.com',
      givenName: 'Ada',
      familyName: 'Lovelace',
    });
  });

  it('rejects an unverified email', async () => {
    const token = await signedIdToken(privateKey, { email_verified: false });
    await expect(verify(token)).rejects.toThrow('Invalid Google ID token');
  });

  it('rejects a nonce mismatch', async () => {
    const token = await signedIdToken(privateKey);
    await expect(verify(token, 'other-nonce')).rejects.toThrow(
      'Invalid Google ID token',
    );
  });

  it('rejects a wrong audience', async () => {
    const token = await signedIdToken(
      privateKey,
      {},
      { audience: 'other-client' },
    );
    await expect(verify(token)).rejects.toThrow('Invalid Google ID token');
  });

  it('rejects an expired token', async () => {
    const token = await signedIdToken(
      privateKey,
      {},
      { expiresIn: Math.floor(Date.now() / 1000) - 60 },
    );
    await expect(verify(token)).rejects.toThrow('Invalid Google ID token');
  });

  it('rejects a wrong authorized-party', async () => {
    const token = await signedIdToken(privateKey, { azp: 'other-client' });
    await expect(verify(token)).rejects.toThrow('Invalid Google ID token');
  });

  it('rejects a wrong issuer', async () => {
    const token = await signedIdToken(
      privateKey,
      {},
      { issuer: 'https://evil.example' },
    );
    await expect(verify(token)).rejects.toThrow('Invalid Google ID token');
  });
});
