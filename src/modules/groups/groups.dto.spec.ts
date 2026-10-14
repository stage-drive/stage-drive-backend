import { BadRequestException, Type, ValidationPipe } from '@nestjs/common';
import { GroupStatus } from '@prisma/client';
import { validationExceptionFactory } from '../../common/validation/field-error';
import { UNSAFE_TEXT_MESSAGE } from '../../common/validators/plain-text.decorator';
import {
  CreateGroupDto,
  DATE_FORMAT_MESSAGE,
  GROUP_NAME_LENGTH_MESSAGE,
  GROUP_NAME_MAX_LENGTH,
  GROUP_STATUS_VALUE_MESSAGE,
  REQUIRED_FIELD_MESSAGE,
  UpdateGroupDto,
  UpdateGroupStatusDto,
} from './groups.dto';

// Same options as configureApp, so the DTOs are checked the way the API runs them.
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

const TEACHER_ID = 'a3b2c1d0-0000-4000-8000-000000000000';

describe('CreateGroupDto', () => {
  const valid = {
    name: 'ПДР — Група А',
    teacherId: TEACHER_ID,
    startDate: '2026-11-01',
    endDate: '2027-01-31',
  };

  it('accepts a valid body and trims the name', async () => {
    await expect(
      validate(CreateGroupDto, { ...valid, name: '  ПДР — Група А  ' }),
    ).resolves.toEqual(valid);
  });

  it('accepts a body without dates', async () => {
    await expect(
      validate(CreateGroupDto, { name: valid.name, teacherId: TEACHER_ID }),
    ).resolves.toEqual({ name: valid.name, teacherId: TEACHER_ID });
  });

  it.each([
    ['missing', { teacherId: TEACHER_ID }],
    ['empty', { ...valid, name: '' }],
    ['whitespace only', { ...valid, name: '   ' }],
  ])('requires name (%s)', async (_, body) => {
    await expect(errorsFor(CreateGroupDto, body)).resolves.toEqual(
      fieldErrors('name', REQUIRED_FIELD_MESSAGE),
    );
  });

  it('rejects a non-string name', async () => {
    await expect(
      errorsFor(CreateGroupDto, { ...valid, name: 42 }),
    ).resolves.toEqual(fieldErrors('name', 'name має бути рядком.'));
  });

  it('accepts a name of exactly the column length', async () => {
    const name = 'Г'.repeat(GROUP_NAME_MAX_LENGTH);
    await expect(
      validate(CreateGroupDto, { ...valid, name }),
    ).resolves.toMatchObject({ name });
  });

  it('rejects a name longer than the column length', async () => {
    await expect(
      errorsFor(CreateGroupDto, {
        ...valid,
        name: 'Г'.repeat(GROUP_NAME_MAX_LENGTH + 1),
      }),
    ).resolves.toEqual(fieldErrors('name', GROUP_NAME_LENGTH_MESSAGE));
  });

  it('rejects markup in the name', async () => {
    await expect(
      errorsFor(CreateGroupDto, { ...valid, name: '<b>Група</b>' }),
    ).resolves.toEqual(fieldErrors('name', UNSAFE_TEXT_MESSAGE));
  });

  it('requires teacherId', async () => {
    await expect(
      errorsFor(CreateGroupDto, { name: valid.name }),
    ).resolves.toEqual(fieldErrors('teacherId', REQUIRED_FIELD_MESSAGE));
  });

  it('rejects a teacherId that is not a UUID', async () => {
    await expect(
      errorsFor(CreateGroupDto, { ...valid, teacherId: 'abc' }),
    ).resolves.toEqual(fieldErrors('teacherId', 'teacherId має бути UUID.'));
  });

  it.each([
    '2026-02-30',
    '2026-13-01',
    '2026-11-01T10:00:00Z',
    '01.11.2026',
    '2026-1-1',
    '',
  ])('rejects startDate %p', async (startDate) => {
    await expect(
      errorsFor(CreateGroupDto, { ...valid, startDate }),
    ).resolves.toEqual(fieldErrors('startDate', DATE_FORMAT_MESSAGE));
  });

  it('rejects a non-string endDate', async () => {
    await expect(
      errorsFor(CreateGroupDto, { ...valid, endDate: 20270131 }),
    ).resolves.toEqual(fieldErrors('endDate', DATE_FORMAT_MESSAGE));
  });

  it.each([
    ['organizationId', '11111111-1111-4111-8111-111111111111'],
    ['status', GroupStatus.ACTIVE],
  ])('rejects %s in the body', async (field, value) => {
    await expect(
      errorsFor(CreateGroupDto, { ...valid, [field]: value }),
    ).resolves.toEqual(
      fieldErrors(field, `property ${field} should not exist`),
    );
  });
});

describe('UpdateGroupDto', () => {
  it('lets an empty body through (the service rejects it)', async () => {
    await expect(validate(UpdateGroupDto, {})).resolves.toEqual({});
  });

  it('accepts null dates to clear them', async () => {
    await expect(
      validate(UpdateGroupDto, { startDate: null, endDate: null }),
    ).resolves.toEqual({ startDate: null, endDate: null });
  });

  it('trims the name', async () => {
    await expect(
      validate(UpdateGroupDto, { name: '  Група Б ' }),
    ).resolves.toEqual({ name: 'Група Б' });
  });

  it('rejects a null name', async () => {
    await expect(errorsFor(UpdateGroupDto, { name: null })).resolves.toEqual(
      fieldErrors('name', 'name має бути рядком.'),
    );
  });

  it('rejects a whitespace-only name', async () => {
    await expect(errorsFor(UpdateGroupDto, { name: '  ' })).resolves.toEqual(
      fieldErrors('name', REQUIRED_FIELD_MESSAGE),
    );
  });

  it('rejects a null teacherId', async () => {
    await expect(
      errorsFor(UpdateGroupDto, { teacherId: null }),
    ).resolves.toEqual(fieldErrors('teacherId', 'teacherId має бути UUID.'));
  });

  it('rejects an invalid date', async () => {
    await expect(
      errorsFor(UpdateGroupDto, { endDate: '2026-02-30' }),
    ).resolves.toEqual(fieldErrors('endDate', DATE_FORMAT_MESSAGE));
  });

  it.each(['organizationId', 'status'])(
    'rejects %s in the body',
    async (field) => {
      await expect(
        errorsFor(UpdateGroupDto, { [field]: 'x' }),
      ).resolves.toEqual(
        fieldErrors(field, `property ${field} should not exist`),
      );
    },
  );
});

describe('UpdateGroupStatusDto', () => {
  it.each(Object.values(GroupStatus))('accepts %s', async (status) => {
    await expect(validate(UpdateGroupStatusDto, { status })).resolves.toEqual({
      status,
    });
  });

  it.each([{}, { status: null }])('requires status (%p)', async (body) => {
    await expect(errorsFor(UpdateGroupStatusDto, body)).resolves.toEqual(
      fieldErrors('status', REQUIRED_FIELD_MESSAGE),
    );
  });

  it.each(['CLOSED', 'active', 3])('rejects status %p', async (status) => {
    await expect(errorsFor(UpdateGroupStatusDto, { status })).resolves.toEqual(
      fieldErrors('status', GROUP_STATUS_VALUE_MESSAGE),
    );
  });
});
