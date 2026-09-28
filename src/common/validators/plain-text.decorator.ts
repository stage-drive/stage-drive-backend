import { Matches } from 'class-validator';

export const UNSAFE_TEXT_MESSAGE = 'Поле містить недопустимі символи.';

export function IsPlainText() {
  return Matches(/^[^<>]*$/u, { message: UNSAFE_TEXT_MESSAGE });
}
