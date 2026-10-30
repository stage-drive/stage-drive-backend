import { BadRequestException, Type, ValidationPipe } from '@nestjs/common';
import { validationExceptionFactory } from '../../common/validation/field-error';
import { UNSAFE_TEXT_MESSAGE } from '../../common/validators/plain-text.decorator';
import {
  CreateStudentDto,
  STUDENT_ADDRESS_MAX_LENGTH,
  STUDENT_CONTRACT_NUMBER_MAX_LENGTH,
  STUDENT_DATE_FORMAT_MESSAGE,
  UpdateStudentDto,
} from './students.dto';

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

describe('CreateStudentDto profile fields', () => {
  const valid = {
    firstName: 'Олена',
    lastName: 'Коваль',
    email: 'student@example.com',
  };

  it('accepts a student without birthDate, address and contractNumber', async () => {
    await expect(validate(CreateStudentDto, valid)).resolves.toEqual(valid);
  });

  it('accepts the optional profile fields and trims text', async () => {
    await expect(
      validate(CreateStudentDto, {
        ...valid,
        birthDate: ' 2004-03-15 ',
        address: '  м. Київ, вул. Хрещатик, 1  ',
        contractNumber: '  Д-2026/0142 ',
      }),
    ).resolves.toEqual({
      ...valid,
      birthDate: '2004-03-15',
      address: 'м. Київ, вул. Хрещатик, 1',
      contractNumber: 'Д-2026/0142',
    });
  });
});

describe('UpdateStudentDto profile fields', () => {
  it('accepts the card fields together and trims text', async () => {
    await expect(
      validate(UpdateStudentDto, {
        firstName: 'Олена',
        lastName: 'Коваль',
        phone: '+380991234567',
        birthDate: '2004-03-15',
        address: '  м. Київ, вул. Хрещатик, 1 ',
        contractNumber: ' Д-2026/0142 ',
      }),
    ).resolves.toEqual({
      firstName: 'Олена',
      lastName: 'Коваль',
      phone: '+380991234567',
      birthDate: '2004-03-15',
      address: 'м. Київ, вул. Хрещатик, 1',
      contractNumber: 'Д-2026/0142',
    });
  });

  it('accepts null and turns a blank value into null', async () => {
    await expect(
      validate(UpdateStudentDto, {
        birthDate: null,
        address: '   ',
        contractNumber: '',
      }),
    ).resolves.toEqual({
      birthDate: null,
      address: null,
      contractNumber: null,
    });
  });

  it('rejects a birthDate that is not YYYY-MM-DD', async () => {
    await expect(
      errorsFor(UpdateStudentDto, { birthDate: '15.03.2004' }),
    ).resolves.toEqual(fieldErrors('birthDate', STUDENT_DATE_FORMAT_MESSAGE));
  });

  it('rejects an impossible calendar date', async () => {
    await expect(
      errorsFor(UpdateStudentDto, { birthDate: '2004-02-31' }),
    ).resolves.toEqual(fieldErrors('birthDate', STUDENT_DATE_FORMAT_MESSAGE));
  });

  it('rejects an address that is too long', async () => {
    await expect(
      errorsFor(UpdateStudentDto, {
        address: 'а'.repeat(STUDENT_ADDRESS_MAX_LENGTH + 1),
      }),
    ).resolves.toEqual(
      fieldErrors(
        'address',
        `Адреса має містити не більше ${STUDENT_ADDRESS_MAX_LENGTH} символів.`,
      ),
    );
  });

  it('rejects a contract number that is too long', async () => {
    await expect(
      errorsFor(UpdateStudentDto, {
        contractNumber: '1'.repeat(STUDENT_CONTRACT_NUMBER_MAX_LENGTH + 1),
      }),
    ).resolves.toEqual(
      fieldErrors(
        'contractNumber',
        `Номер договору має містити не більше ${STUDENT_CONTRACT_NUMBER_MAX_LENGTH} символів.`,
      ),
    );
  });

  it('rejects markup in address and contractNumber', async () => {
    await expect(
      errorsFor(UpdateStudentDto, { address: '<script>' }),
    ).resolves.toEqual(fieldErrors('address', UNSAFE_TEXT_MESSAGE));
    await expect(
      errorsFor(UpdateStudentDto, { contractNumber: '<b>1</b>' }),
    ).resolves.toEqual(fieldErrors('contractNumber', UNSAFE_TEXT_MESSAGE));
  });

  it('still rejects a field outside the allowed set', async () => {
    await expect(
      errorsFor(UpdateStudentDto, {
        birthDate: '2004-03-15',
        role: 'OWNER',
      }),
    ).resolves.toEqual(fieldErrors('role', 'property role should not exist'));
  });
});
