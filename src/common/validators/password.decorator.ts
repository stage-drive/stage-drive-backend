import { Matches, MaxLength, MinLength } from 'class-validator';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;
export const PASSWORD_TOO_SHORT_MESSAGE =
  'Пароль має містити щонайменше 8 символів.';
export const PASSWORD_TOO_LONG_MESSAGE = 'Пароль занадто довгий.';
export const PASSWORD_COMPLEXITY_MESSAGE =
  'Пароль має містити велику літеру, цифру та спеціальний символ.';

export const PASSWORD_COMPLEXITY_PATTERN =
  /^(?=.*\p{Lu})(?=.*\d)(?=.*[^\p{L}\p{N}\s]).+$/u;

export function IsStrongEnoughPassword(): PropertyDecorator {
  return (target, propertyKey) => {
    const key = propertyKey as string;
    MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_TOO_SHORT_MESSAGE })(
      target,
      key,
    );
    Matches(PASSWORD_COMPLEXITY_PATTERN, {
      message: PASSWORD_COMPLEXITY_MESSAGE,
    })(target, key);
    MaxLength(PASSWORD_MAX_LENGTH, { message: PASSWORD_TOO_LONG_MESSAGE })(
      target,
      key,
    );
  };
}
