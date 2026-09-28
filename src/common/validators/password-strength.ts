export const PASSWORD_STRENGTH_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).+$/;

export const PASSWORD_STRENGTH_MESSAGE =
  'Пароль має містити щонайменше одну велику літеру, одну малу літеру, ' +
  'одну цифру та один спеціальний символ.';
