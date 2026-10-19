import { BadRequestException, Type, ValidationPipe } from '@nestjs/common';
import { CourseStatus } from '@prisma/client';
import { validationExceptionFactory } from '../../common/validation/field-error';
import { UNSAFE_TEXT_MESSAGE } from '../../common/validators/plain-text.decorator';
import {
  COURSE_DESCRIPTION_LENGTH_MESSAGE,
  COURSE_DESCRIPTION_MAX_LENGTH,
  COURSE_NAME_LENGTH_MESSAGE,
  COURSE_NAME_MAX_LENGTH,
  CreateCourseDto,
  REQUIRED_FIELD_MESSAGE,
  UpdateCourseDto,
} from './courses.dto';

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

describe('CreateCourseDto', () => {
  const valid = {
    name: 'Теоретичний курс, категорія B',
    description: 'ПДР, основи безпеки руху та будова автомобіля.',
  };

  it('accepts a valid body and trims name and description', async () => {
    await expect(
      validate(CreateCourseDto, {
        name: '  Теоретичний курс, категорія B  ',
        description: '  ПДР  ',
      }),
    ).resolves.toEqual({
      name: valid.name,
      description: 'ПДР',
    });
  });

  it('accepts a body without a description', async () => {
    await expect(
      validate(CreateCourseDto, { name: valid.name }),
    ).resolves.toEqual({ name: valid.name });
  });

  it.each([null, '', '   '])(
    'stores an empty description as null (%p)',
    async (description) => {
      await expect(
        validate(CreateCourseDto, { name: valid.name, description }),
      ).resolves.toEqual({ name: valid.name, description: null });
    },
  );

  it.each([
    ['missing', {}],
    ['empty', { name: '' }],
    ['whitespace only', { name: '   ' }],
  ])('requires name (%s)', async (_, body) => {
    await expect(errorsFor(CreateCourseDto, body)).resolves.toEqual(
      fieldErrors('name', REQUIRED_FIELD_MESSAGE),
    );
  });

  it('rejects a non-string name', async () => {
    await expect(errorsFor(CreateCourseDto, { name: 42 })).resolves.toEqual(
      fieldErrors('name', 'name має бути рядком.'),
    );
  });

  it('accepts a name of exactly the column length', async () => {
    const name = 'К'.repeat(COURSE_NAME_MAX_LENGTH);
    await expect(validate(CreateCourseDto, { name })).resolves.toEqual({
      name,
    });
  });

  it('rejects a name longer than the column length', async () => {
    await expect(
      errorsFor(CreateCourseDto, {
        name: 'К'.repeat(COURSE_NAME_MAX_LENGTH + 1),
      }),
    ).resolves.toEqual(fieldErrors('name', COURSE_NAME_LENGTH_MESSAGE));
  });

  it('rejects markup in the name', async () => {
    await expect(
      errorsFor(CreateCourseDto, { name: '<b>Курс</b>' }),
    ).resolves.toEqual(fieldErrors('name', UNSAFE_TEXT_MESSAGE));
  });

  it('rejects a non-string description', async () => {
    await expect(
      errorsFor(CreateCourseDto, { ...valid, description: 1 }),
    ).resolves.toEqual(
      fieldErrors('description', 'description має бути рядком або null.'),
    );
  });

  it('rejects markup in the description', async () => {
    await expect(
      errorsFor(CreateCourseDto, { ...valid, description: '<script>' }),
    ).resolves.toEqual(fieldErrors('description', UNSAFE_TEXT_MESSAGE));
  });

  it('rejects a description longer than the limit', async () => {
    await expect(
      errorsFor(CreateCourseDto, {
        ...valid,
        description: 'О'.repeat(COURSE_DESCRIPTION_MAX_LENGTH + 1),
      }),
    ).resolves.toEqual(
      fieldErrors('description', COURSE_DESCRIPTION_LENGTH_MESSAGE),
    );
  });

  it.each([
    ['organizationId', '11111111-1111-4111-8111-111111111111'],
    ['status', CourseStatus.ARCHIVED],
  ])('rejects %s in the body', async (field, value) => {
    await expect(
      errorsFor(CreateCourseDto, { ...valid, [field]: value }),
    ).resolves.toEqual(
      fieldErrors(field, `property ${field} should not exist`),
    );
  });
});

describe('UpdateCourseDto', () => {
  it('lets an empty body through (the service rejects it)', async () => {
    await expect(validate(UpdateCourseDto, {})).resolves.toEqual({});
  });

  it('trims the name and description', async () => {
    await expect(
      validate(UpdateCourseDto, {
        name: '  Курс Б ',
        description: '  Опис ',
      }),
    ).resolves.toEqual({ name: 'Курс Б', description: 'Опис' });
  });

  it.each([null, '', '   '])(
    'clears the description with %p',
    async (description) => {
      await expect(validate(UpdateCourseDto, { description })).resolves.toEqual(
        { description: null },
      );
    },
  );

  it('rejects a null name', async () => {
    await expect(errorsFor(UpdateCourseDto, { name: null })).resolves.toEqual(
      fieldErrors('name', 'name має бути рядком.'),
    );
  });

  it('rejects a whitespace-only name', async () => {
    await expect(errorsFor(UpdateCourseDto, { name: '  ' })).resolves.toEqual(
      fieldErrors('name', REQUIRED_FIELD_MESSAGE),
    );
  });

  it.each(['organizationId', 'status'])(
    'rejects %s in the body',
    async (field) => {
      await expect(
        errorsFor(UpdateCourseDto, { [field]: 'x' }),
      ).resolves.toEqual(
        fieldErrors(field, `property ${field} should not exist`),
      );
    },
  );
});
