import { BadRequestException, Type, ValidationPipe } from '@nestjs/common';
import { validationExceptionFactory } from '../../common/validation/field-error';
import {
  LESSON_DURATION_MESSAGE,
  REQUIRED_FIELD_MESSAGE,
  SCHEDULE_RANGE_FORMAT_MESSAGE,
  SCHEDULED_AT_FORMAT_MESSAGE,
} from './lessons.dto';
import {
  CreatePracticeSlotDto,
  PracticeSlotListQueryDto,
  UpdatePracticeSlotDto,
} from './practice-slots.dto';

// Same options as configureApp, so the DTOs are checked the way the API runs them.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  stopAtFirstError: true,
  exceptionFactory: validationExceptionFactory,
});

type Source = 'body' | 'query';

function validate(
  metatype: Type<unknown>,
  value: unknown,
  type: Source = 'body',
): Promise<unknown> {
  return pipe.transform(value, { type, metatype });
}

async function errorsFor(
  metatype: Type<unknown>,
  value: unknown,
  type: Source = 'body',
): Promise<unknown> {
  try {
    await validate(metatype, value, type);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse();
  }
  throw new Error('Expected validation to fail');
}

function fieldErrors(field: string, message: string) {
  return { statusCode: 400, errors: [{ field, message }] };
}

const INSTRUCTOR_ID = '5b0c0000-0000-4000-8000-000000000000';
const CAR_ID = 'c7d20000-0000-4000-8000-000000000000';

describe('CreatePracticeSlotDto', () => {
  const valid = {
    instructorId: INSTRUCTOR_ID,
    carId: CAR_ID,
    scheduledAt: '2026-11-16T10:00:00+02:00',
  };

  it('accepts a slot without durationMin', async () => {
    await expect(validate(CreatePracticeSlotDto, valid)).resolves.toEqual(
      valid,
    );
  });

  it('accepts durationMin within 15–240', async () => {
    await expect(
      validate(CreatePracticeSlotDto, { ...valid, durationMin: 90 }),
    ).resolves.toEqual({ ...valid, durationMin: 90 });
  });

  it.each(['instructorId', 'carId', 'scheduledAt'] as const)(
    'requires %s',
    async (field) => {
      const body: Record<string, unknown> = { ...valid };
      delete body[field];

      await expect(errorsFor(CreatePracticeSlotDto, body)).resolves.toEqual(
        fieldErrors(field, REQUIRED_FIELD_MESSAGE),
      );
    },
  );

  it.each([
    ['instructorId', 'instructorId має бути UUID.'],
    ['carId', 'carId має бути UUID.'],
  ] as const)('rejects a non-UUID %s', async (field, message) => {
    await expect(
      errorsFor(CreatePracticeSlotDto, { ...valid, [field]: 'not-a-uuid' }),
    ).resolves.toEqual(fieldErrors(field, message));
  });

  it.each(['2026-11-16T10:00:00', '2026-11-16', '16.11.2026 10:00'])(
    'rejects scheduledAt %s',
    async (scheduledAt) => {
      await expect(
        errorsFor(CreatePracticeSlotDto, { ...valid, scheduledAt }),
      ).resolves.toEqual(
        fieldErrors('scheduledAt', SCHEDULED_AT_FORMAT_MESSAGE),
      );
    },
  );

  it.each([14, 241, 60.5, null, '60'])(
    'rejects durationMin %p',
    async (durationMin) => {
      await expect(
        errorsFor(CreatePracticeSlotDto, { ...valid, durationMin }),
      ).resolves.toEqual(fieldErrors('durationMin', LESSON_DURATION_MESSAGE));
    },
  );

  it.each(['organizationId', 'status', 'createdById'])(
    'rejects the extra field %s',
    async (field) => {
      await expect(
        errorsFor(CreatePracticeSlotDto, { ...valid, [field]: 'x' }),
      ).resolves.toEqual(
        fieldErrors(field, `property ${field} should not exist`),
      );
    },
  );
});

describe('UpdatePracticeSlotDto', () => {
  it('lets an empty body through: the service rejects it', async () => {
    await expect(validate(UpdatePracticeSlotDto, {})).resolves.toEqual({});
  });

  it('accepts a partial change', async () => {
    const body = { scheduledAt: '2026-11-16T12:00:00+02:00', durationMin: 90 };

    await expect(validate(UpdatePracticeSlotDto, body)).resolves.toEqual(body);
  });

  it.each([
    ['instructorId', 'instructorId має бути UUID.'],
    ['carId', 'carId має бути UUID.'],
  ] as const)('rejects %s: null', async (field, message) => {
    await expect(
      errorsFor(UpdatePracticeSlotDto, { [field]: null }),
    ).resolves.toEqual(fieldErrors(field, message));
  });

  it.each([null, '2026-11-16T12:00:00'])(
    'rejects scheduledAt %p',
    async (scheduledAt) => {
      await expect(
        errorsFor(UpdatePracticeSlotDto, { scheduledAt }),
      ).resolves.toEqual(
        fieldErrors('scheduledAt', SCHEDULED_AT_FORMAT_MESSAGE),
      );
    },
  );

  it('rejects durationMin: null', async () => {
    await expect(
      errorsFor(UpdatePracticeSlotDto, { durationMin: null }),
    ).resolves.toEqual(fieldErrors('durationMin', LESSON_DURATION_MESSAGE));
  });
});

describe('PracticeSlotListQueryDto', () => {
  it('accepts an empty query', async () => {
    await expect(
      validate(PracticeSlotListQueryDto, {}, 'query'),
    ).resolves.toEqual({});
  });

  it('accepts a window with filters', async () => {
    const query = {
      from: '2026-11-16T00:00:00+02:00',
      to: '2026-11-23T00:00:00+02:00',
      instructorId: INSTRUCTOR_ID,
      carId: CAR_ID,
    };

    await expect(
      validate(PracticeSlotListQueryDto, query, 'query'),
    ).resolves.toEqual(query);
  });

  it.each(['from', 'to'] as const)(
    'rejects %s without an offset',
    async (field) => {
      await expect(
        errorsFor(
          PracticeSlotListQueryDto,
          { [field]: '2026-11-16T00:00:00' },
          'query',
        ),
      ).resolves.toEqual(fieldErrors(field, SCHEDULE_RANGE_FORMAT_MESSAGE));
    },
  );

  it.each([
    ['instructorId', 'instructorId має бути UUID.'],
    ['carId', 'carId має бути UUID.'],
  ] as const)('rejects a non-UUID %s', async (field, message) => {
    await expect(
      errorsFor(PracticeSlotListQueryDto, { [field]: 'nope' }, 'query'),
    ).resolves.toEqual(fieldErrors(field, message));
  });

  it('rejects organizationId', async () => {
    await expect(
      errorsFor(PracticeSlotListQueryDto, { organizationId: 'x' }, 'query'),
    ).resolves.toEqual(
      fieldErrors('organizationId', 'property organizationId should not exist'),
    );
  });
});
