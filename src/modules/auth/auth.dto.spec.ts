import { BadRequestException, Type, ValidationPipe } from '@nestjs/common';
import { validationExceptionFactory } from '../../common/validation/field-error';
import { PASSWORD_STRENGTH_MESSAGE } from '../../common/validators/password-strength';
import { UNSAFE_TEXT_MESSAGE } from '../../common/validators/plain-text.decorator';
import { CheckEmailDto, ValidateRegistrationFieldsDto } from './auth.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  stopAtFirstError: true,
  exceptionFactory: validationExceptionFactory,
});

function validate(metatype: Type<unknown>, body: unknown): Promise<unknown> {
  return pipe.transform(body, { type: 'body', metatype });
}

async function errorsFor(
  metatype: Type<unknown>,
  body: unknown,
): Promise<unknown> {
  try {
    await validate(metatype, body);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse();
  }
  throw new Error('Expected validation to fail');
}

function fieldErrors(field: string, message: string) {
  return { statusCode: 400, errors: [{ field, message }] };
}

describe('CheckEmailDto', () => {
  it('accepts an email', async () => {
    await expect(
      validate(CheckEmailDto, { email: 'new-owner@example.com' }),
    ).resolves.toEqual({ email: 'new-owner@example.com' });
  });

  it('reports an empty email before the format error', async () => {
    await expect(errorsFor(CheckEmailDto, { email: '' })).resolves.toEqual(
      fieldErrors('email', "Заповніть обов'язкове поле."),
    );
    await expect(errorsFor(CheckEmailDto, {})).resolves.toEqual(
      fieldErrors('email', "Заповніть обов'язкове поле."),
    );
  });

  it('reports an invalid email', async () => {
    await expect(
      errorsFor(CheckEmailDto, { email: 'not-an-email' }),
    ).resolves.toEqual(fieldErrors('email', 'Введіть коректний email.'));
  });
});

describe('ValidateRegistrationFieldsDto', () => {
  it('accepts a single valid field and ignores the rest', async () => {
    await expect(
      validate(ValidateRegistrationFieldsDto, { firstName: 'Іван' }),
    ).resolves.toEqual({ firstName: 'Іван' });
    await expect(
      validate(ValidateRegistrationFieldsDto, { phone: '+380991234567' }),
    ).resolves.toEqual({ phone: '+380991234567' });
    await expect(
      validate(ValidateRegistrationFieldsDto, { phone: null }),
    ).resolves.toEqual({ phone: null });
    await expect(validate(ValidateRegistrationFieldsDto, {})).resolves.toEqual(
      {},
    );
  });

  it('reports an invalid phone without the other registration fields', async () => {
    await expect(
      errorsFor(ValidateRegistrationFieldsDto, { phone: '123' }),
    ).resolves.toEqual(
      fieldErrors('phone', 'Введіть коректний номер телефону.'),
    );
  });

  it('reports an empty required field and unsafe text', async () => {
    await expect(
      errorsFor(ValidateRegistrationFieldsDto, { organizationName: '' }),
    ).resolves.toEqual(
      fieldErrors('organizationName', "Заповніть обов'язкове поле."),
    );
    await expect(
      errorsFor(ValidateRegistrationFieldsDto, {
        firstName: '<script>',
      }),
    ).resolves.toEqual(fieldErrors('firstName', UNSAFE_TEXT_MESSAGE));
  });

  it('reports a weak password and a confirmation mismatch', async () => {
    await expect(
      errorsFor(ValidateRegistrationFieldsDto, { password: 'password1!' }),
    ).resolves.toEqual(fieldErrors('password', PASSWORD_STRENGTH_MESSAGE));
    await expect(
      errorsFor(ValidateRegistrationFieldsDto, {
        password: 'SecurePassword123!',
        passwordConfirmation: 'SecurePassword123?',
      }),
    ).resolves.toEqual(
      fieldErrors('passwordConfirmation', 'Паролі не співпадають.'),
    );
  });

  it('requires the terms checkbox to be accepted when it is sent', async () => {
    await expect(
      errorsFor(ValidateRegistrationFieldsDto, { termsAccepted: false }),
    ).resolves.toEqual(
      fieldErrors(
        'termsAccepted',
        'Потрібно погодитися з умовами використання.',
      ),
    );
    await expect(
      validate(ValidateRegistrationFieldsDto, { termsAccepted: true }),
    ).resolves.toEqual({ termsAccepted: true });
  });

  it('rejects a field that is not part of registration', async () => {
    await expect(
      errorsFor(ValidateRegistrationFieldsDto, { role: 'OWNER' }),
    ).resolves.toEqual(fieldErrors('role', 'property role should not exist'));
  });
});
