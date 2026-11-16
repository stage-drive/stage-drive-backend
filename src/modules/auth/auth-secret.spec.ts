import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AUTH_SECRET_MIN_LENGTH, validateAuthSecret } from './auth-secret';

const REPO_ROOT = join(__dirname, '..', '..', '..');

function randomHex(length: number): string {
  return randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);
}

describe('validateAuthSecret', () => {
  it('accepts a secret generated with openssl rand -base64 32', () => {
    const secret = randomBytes(32).toString('base64');

    expect(validateAuthSecret(secret)).toBe(secret);
  });

  it('accepts a secret of exactly the minimum length', () => {
    const secret = randomHex(AUTH_SECRET_MIN_LENGTH);

    expect(validateAuthSecret(secret)).toBe(secret);
  });

  it('trims surrounding whitespace, so the signing key matches what was configured', () => {
    const secret = randomBytes(32).toString('base64');

    expect(validateAuthSecret(`  ${secret}\n`)).toBe(secret);
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['whitespace only', '   \n\t'],
  ])('rejects a missing secret (%s)', (_label, value) => {
    expect(() => validateAuthSecret(value)).toThrow(/AUTH_SECRET is not set/);
  });

  it('rejects a secret one character shorter than the minimum', () => {
    expect(() =>
      validateAuthSecret(randomHex(AUTH_SECRET_MIN_LENGTH - 1)),
    ).toThrow(/AUTH_SECRET is too short/);
  });

  it.each([
    // The values that used to ship as defaults in this repository.
    'change-me-in-production',
    'stage-drive-dev-secret',
    'test-auth-secret',
  ])('rejects the former repository default "%s"', (value) => {
    expect(() => validateAuthSecret(value)).toThrow(/AUTH_SECRET/);
  });

  it.each([
    'change-me-in-production-change-me-in-production',
    'CHANGE-ME-IN-PRODUCTION-0123456789abcdef',
    `changeme-${randomHex(40)}`,
    `${randomHex(20)}-replace-me-${randomHex(20)}`,
    `your-secret-${randomHex(40)}`,
    `stage-drive-dev-secret-${randomHex(20)}`,
    `test-auth-secret-${randomHex(20)}`,
  ])('rejects a long value built from a placeholder (%s)', (value) => {
    expect(() => validateAuthSecret(value)).toThrow(
      /AUTH_SECRET contains a placeholder value/,
    );
  });

  it.each([
    ['a single repeated character', 'a'.repeat(64)],
    ['a short repeated pattern', 'abcd'.repeat(16)],
    ['seven distinct characters', '1234567'.repeat(6)],
  ])('rejects a long but repetitive secret (%s)', (_label, value) => {
    expect(() => validateAuthSecret(value)).toThrow(
      /AUTH_SECRET is too repetitive/,
    );
  });

  it('never puts the secret value in the error message', () => {
    const tooShort = randomHex(AUTH_SECRET_MIN_LENGTH - 1);
    const placeholder = `change-me-${randomHex(40)}`;
    const repetitive = 'abcd'.repeat(16);

    for (const value of [tooShort, placeholder, repetitive]) {
      let message = '';
      try {
        validateAuthSecret(value);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/AUTH_SECRET/);
      expect(message).not.toContain(value);
    }
  });

  it('tells the operator how to generate a valid secret', () => {
    expect(() => validateAuthSecret('')).toThrow(/openssl rand -base64 32/);
  });
});

describe('AUTH_SECRET defaults shipped with the repository', () => {
  it('docker-compose.yml has no fallback AUTH_SECRET for the backend', () => {
    const compose = readFileSync(join(REPO_ROOT, 'docker-compose.yml'), 'utf8');
    const line = compose
      .split('\n')
      .find((row) => /^\s*AUTH_SECRET:/.test(row));

    expect(line).toBeDefined();
    // Allowed: ${AUTH_SECRET} or ${AUTH_SECRET:-} (empty default).
    expect(line?.trim()).toMatch(/^AUTH_SECRET:\s*\$\{AUTH_SECRET(:-)?\}$/);
  });

  it('.env.example ships no AUTH_SECRET the API would accept', () => {
    const example = readFileSync(join(REPO_ROOT, '.env.example'), 'utf8');
    const line = example
      .split('\n')
      .find((row) => row.startsWith('AUTH_SECRET='));

    expect(line).toBeDefined();
    const value = line?.slice('AUTH_SECRET='.length);
    expect(() => validateAuthSecret(value)).toThrow(/AUTH_SECRET/);
  });
});
