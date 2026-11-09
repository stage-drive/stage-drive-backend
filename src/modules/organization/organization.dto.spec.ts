import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { validationExceptionFactory } from '../../common/validation/field-error';
import { UNSAFE_TEXT_MESSAGE } from '../../common/validators/plain-text.decorator';
import {
  ORGANIZATION_EMAIL_MESSAGE,
  ORGANIZATION_PHONE_MESSAGE,
  ORGANIZATION_REQUIRED_FIELD_MESSAGE,
  UpdateOrganizationDto,
} from './organization.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  stopAtFirstError: true,
  exceptionFactory: validationExceptionFactory,
});

function validate(body: unknown): Promise<UpdateOrganizationDto> {
  return pipe.transform(body, {
    type: 'body',
    metatype: UpdateOrganizationDto,
  }) as Promise<UpdateOrganizationDto>;
}

async function errorsFor(body: unknown): Promise<unknown> {
  try {
    await validate(body);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse();
  }
  throw new Error('Expected validation to fail');
}

function fieldError(field: string, message: string) {
  return { statusCode: 400, errors: [{ field, message }] };
}

describe('UpdateOrganizationDto', () => {
  it('accepts and normalizes all editable fields', async () => {
    await expect(
      validate({
        name: '  Автошкола Drive ',
        email: ' Info@StageDrive.UA ',
        phone: ' +380 44 123-45-67 ',
        address: ' м. Київ, вул. Хрещатик, 1 ',
      }),
    ).resolves.toEqual({
      name: 'Автошкола Drive',
      email: 'info@stagedrive.ua',
      phone: '+380 44 123-45-67',
      address: 'м. Київ, вул. Хрещатик, 1',
    });
  });

  it('accepts a partial update', async () => {
    await expect(validate({ phone: '+380441234567' })).resolves.toEqual({
      phone: '+380441234567',
    });
  });

  it.each([
    ['null', null],
    ['an empty string', ''],
    ['whitespace', '   '],
  ])('clears phone and address with %s', async (_label, value) => {
    await expect(validate({ phone: value, address: value })).resolves.toEqual({
      phone: null,
      address: null,
    });
  });

  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['null', null],
  ])('rejects a %s name', async (_label, name) => {
    await expect(errorsFor({ name })).resolves.toEqual(
      fieldError('name', ORGANIZATION_REQUIRED_FIELD_MESSAGE),
    );
  });

  it.each([
    ['empty', ''],
    ['null', null],
  ])('rejects a %s email', async (_label, email) => {
    await expect(errorsFor({ email })).resolves.toEqual(
      fieldError('email', ORGANIZATION_REQUIRED_FIELD_MESSAGE),
    );
  });

  it('rejects an invalid email', async () => {
    await expect(errorsFor({ email: 'not-an-email' })).resolves.toEqual(
      fieldError('email', ORGANIZATION_EMAIL_MESSAGE),
    );
  });

  it.each(['call us', '123', '+38044123456789012345'])(
    'rejects the phone %s',
    async (phone) => {
      await expect(errorsFor({ phone })).resolves.toEqual(
        fieldError('phone', ORGANIZATION_PHONE_MESSAGE),
      );
    },
  );

  it('rejects markup in name and address', async () => {
    await expect(errorsFor({ name: '<b>Drive</b>' })).resolves.toEqual(
      fieldError('name', UNSAFE_TEXT_MESSAGE),
    );
    await expect(
      errorsFor({ address: '<script>alert(1)</script>' }),
    ).resolves.toEqual(fieldError('address', UNSAFE_TEXT_MESSAGE));
  });

  it('rejects values over the column limits', async () => {
    await expect(errorsFor({ name: 'а'.repeat(121) })).resolves.toEqual(
      fieldError('name', 'Назва має містити не більше 120 символів.'),
    );
    await expect(errorsFor({ address: 'а'.repeat(256) })).resolves.toEqual(
      fieldError('address', 'Адреса має містити не більше 255 символів.'),
    );
  });

  it('rejects non-string values', async () => {
    await expect(errorsFor({ name: 42 })).resolves.toEqual(
      fieldError('name', 'name має бути рядком.'),
    );
    await expect(errorsFor({ phone: 380441234567 })).resolves.toEqual(
      fieldError('phone', 'phone має бути рядком або null.'),
    );
  });

  it.each([
    'timezone',
    'status',
    'slug',
    'logoUrl',
    'id',
    'organizationId',
    'deletedAt',
  ])('rejects the read-only field %s', async (field) => {
    await expect(
      errorsFor({ name: 'Drive', [field]: 'value' }),
    ).resolves.toEqual(fieldError(field, `property ${field} should not exist`));
  });
});
