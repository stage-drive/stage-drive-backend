import { PASSWORD_STRENGTH_REGEX } from './password-strength';

describe('PASSWORD_STRENGTH_REGEX', () => {
  it.each([
    ['        ', 'whitespace-only'],
    ['12345678', 'digits-only'],
    ['!!!!!!!!', 'special-chars-only'],
    ['password', 'lowercase-only'],
  ])('rejects %s (%s)', (value) => {
    expect(PASSWORD_STRENGTH_REGEX.test(value)).toBe(false);
  });

  it('accepts a password with upper, lower, digit and special char', () => {
    expect(PASSWORD_STRENGTH_REGEX.test('SecurePassword123!')).toBe(true);
  });
});
