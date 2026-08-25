import { createHash, randomBytes } from 'crypto';

export function createPkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function randomOAuthValue(): string {
  return randomBytes(32).toString('base64url');
}
