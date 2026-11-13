/**
 * AUTH_SECRET is the HMAC-SHA256 key for access tokens. Anyone who knows it
 * can mint a token for any user, so the API refuses to start with a missing,
 * short, placeholder or trivially repetitive value.
 */
export const AUTH_SECRET_MIN_LENGTH = 32;

/** Rejects values like "aaaa…" or "abababab…" that pass the length check. */
const AUTH_SECRET_MIN_DISTINCT_CHARS = 8;

/** Lower-case fragments of example values from docs, compose files and tests. */
const AUTH_SECRET_PLACEHOLDER_MARKERS = [
  'change-me',
  'changeme',
  'replace-me',
  'your-secret',
  'stage-drive-dev-secret',
  'test-auth-secret',
];

const GENERATE_HINT = 'Generate one with: openssl rand -base64 32';

/**
 * Returns the trimmed secret or throws. The message never includes the value
 * itself, because startup errors end up in logs.
 */
export function validateAuthSecret(raw: string | undefined): string {
  const secret = (raw ?? '').trim();

  if (!secret) {
    throw new Error(`AUTH_SECRET is not set. ${GENERATE_HINT}`);
  }

  if (secret.length < AUTH_SECRET_MIN_LENGTH) {
    throw new Error(
      `AUTH_SECRET is too short (${secret.length} characters, at least ${AUTH_SECRET_MIN_LENGTH} required). ${GENERATE_HINT}`,
    );
  }

  const lowered = secret.toLowerCase();
  if (
    AUTH_SECRET_PLACEHOLDER_MARKERS.some((marker) => lowered.includes(marker))
  ) {
    throw new Error(
      `AUTH_SECRET contains a placeholder value. ${GENERATE_HINT}`,
    );
  }

  if (new Set(secret).size < AUTH_SECRET_MIN_DISTINCT_CHARS) {
    throw new Error(
      `AUTH_SECRET is too repetitive (fewer than ${AUTH_SECRET_MIN_DISTINCT_CHARS} distinct characters). ${GENERATE_HINT}`,
    );
  }

  return secret;
}
