import { BadRequestException, Type, ValidationPipe } from '@nestjs/common';
import { validationExceptionFactory } from '../../common/validation/field-error';
import { UNSAFE_TEXT_MESSAGE } from '../../common/validators/plain-text.decorator';
import {
  CANCELLATION_REASON_LENGTH_MESSAGE,
  CANCELLATION_REASON_MAX_LENGTH,
  CancelLessonDto,
  LESSON_DURATION_MESSAGE,
  LESSON_TOPIC_LENGTH_MESSAGE,
  LESSON_TOPIC_MAX_LENGTH,
  REQUIRED_FIELD_MESSAGE,
  RescheduleLessonDto,
  SCHEDULED_AT_FORMAT_MESSAGE,
  UpdatePracticeLessonDto,
  UpdateTheoryLessonDto,
} from './lessons.dto';

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

const INSTRUCTOR_ID = 'a3b2c1d0-0000-4000-8000-000000000000';
const CAR_ID = 'c7d2e1f0-0000-4000-8000-000000000000';

describe('RescheduleLessonDto', () => {
  it.each([
    '2026-11-03T10:00:00+02:00',
    '2026-11-03T08:00:00Z',
    '2026-11-03T08:00:00.000Z',
    '2026-11-03T05:30:00-05:00',
  ])('accepts %s', async (scheduledAt) => {
    await expect(
      validate(RescheduleLessonDto, { scheduledAt }),
    ).resolves.toEqual({ scheduledAt });
  });

  it.each([
    ['without an offset', '2026-11-03T10:00:00'],
    ['date only', '2026-11-03'],
    ['without seconds', '2026-11-03T10:00+02:00'],
    ['a non-existent date', '2026-02-30T10:00:00Z'],
    ['a non-ISO format', '03.11.2026 10:00'],
    ['a timestamp number', 1793433600000],
  ])('rejects %s', async (_, scheduledAt) => {
    await expect(
      errorsFor(RescheduleLessonDto, { scheduledAt }),
    ).resolves.toEqual(fieldErrors('scheduledAt', SCHEDULED_AT_FORMAT_MESSAGE));
  });

  it.each([
    ['missing', {}],
    ['null', { scheduledAt: null }],
  ])('requires scheduledAt (%s)', async (_, body) => {
    await expect(errorsFor(RescheduleLessonDto, body)).resolves.toEqual(
      fieldErrors('scheduledAt', REQUIRED_FIELD_MESSAGE),
    );
  });

  it.each([15, 240])('accepts durationMin %s', async (durationMin) => {
    const body = { scheduledAt: '2026-11-03T08:00:00Z', durationMin };

    await expect(validate(RescheduleLessonDto, body)).resolves.toEqual(body);
  });

  it.each([14, 241, 60.5, '60', null])(
    'rejects durationMin %p',
    async (durationMin) => {
      await expect(
        errorsFor(RescheduleLessonDto, {
          scheduledAt: '2026-11-03T08:00:00Z',
          durationMin,
        }),
      ).resolves.toEqual(fieldErrors('durationMin', LESSON_DURATION_MESSAGE));
    },
  );

  it.each(['status', 'instructorId', 'organizationId'])(
    'rejects an unknown field %s',
    async (field) => {
      await expect(
        errorsFor(RescheduleLessonDto, {
          scheduledAt: '2026-11-03T08:00:00Z',
          [field]: 'x',
        }),
      ).resolves.toEqual(
        fieldErrors(field, `property ${field} should not exist`),
      );
    },
  );
});

describe('UpdateTheoryLessonDto', () => {
  it('lets an empty body through (the service rejects it)', async () => {
    await expect(validate(UpdateTheoryLessonDto, {})).resolves.toEqual({});
  });

  it('trims the topic', async () => {
    await expect(
      validate(UpdateTheoryLessonDto, { topic: '  Дорожні знаки  ' }),
    ).resolves.toEqual({ topic: 'Дорожні знаки' });
  });

  it.each([
    ['whitespace only', '   ', REQUIRED_FIELD_MESSAGE],
    ['null', null, 'topic має бути рядком.'],
    [
      'too long',
      'а'.repeat(LESSON_TOPIC_MAX_LENGTH + 1),
      LESSON_TOPIC_LENGTH_MESSAGE,
    ],
    ['markup', '<b>Знаки</b>', UNSAFE_TEXT_MESSAGE],
  ])('rejects a topic that is %s', async (_, topic, message) => {
    await expect(
      errorsFor(UpdateTheoryLessonDto, { topic }),
    ).resolves.toMatchObject({
      statusCode: 400,
      errors: [{ field: 'topic', message }],
    });
  });

  it('rejects a null durationMin', async () => {
    await expect(
      errorsFor(UpdateTheoryLessonDto, { durationMin: null }),
    ).resolves.toEqual(fieldErrors('durationMin', LESSON_DURATION_MESSAGE));
  });

  it.each(['scheduledAt', 'status', 'groupId'])(
    'rejects %s in the body',
    async (field) => {
      await expect(
        errorsFor(UpdateTheoryLessonDto, { [field]: 'x' }),
      ).resolves.toEqual(
        fieldErrors(field, `property ${field} should not exist`),
      );
    },
  );
});

describe('UpdatePracticeLessonDto', () => {
  it('accepts instructorId, carId and durationMin', async () => {
    const body = {
      instructorId: INSTRUCTOR_ID,
      carId: CAR_ID,
      durationMin: 90,
    };

    await expect(validate(UpdatePracticeLessonDto, body)).resolves.toEqual(
      body,
    );
  });

  it.each([
    ['instructorId', 'abc', 'instructorId має бути UUID.'],
    ['instructorId', null, 'instructorId має бути UUID.'],
    ['carId', null, 'carId має бути UUID.'],
  ])('rejects %s = %p', async (field, value, message) => {
    await expect(
      errorsFor(UpdatePracticeLessonDto, { [field]: value }),
    ).resolves.toEqual(fieldErrors(field, message));
  });

  it.each(['studentId', 'scheduledAt', 'status'])(
    'rejects %s in the body',
    async (field) => {
      await expect(
        errorsFor(UpdatePracticeLessonDto, { [field]: 'x' }),
      ).resolves.toEqual(
        fieldErrors(field, `property ${field} should not exist`),
      );
    },
  );
});

describe('CancelLessonDto', () => {
  it('lets an empty body through', async () => {
    await expect(validate(CancelLessonDto, {})).resolves.toEqual({});
  });

  it('lets a missing body through', async () => {
    await expect(validate(CancelLessonDto, undefined)).resolves.toEqual({});
  });

  it('trims the reason', async () => {
    await expect(
      validate(CancelLessonDto, { reason: '  Викладач захворів  ' }),
    ).resolves.toEqual({ reason: 'Викладач захворів' });
  });

  it('accepts a reason of exactly the maximum length', async () => {
    const reason = 'а'.repeat(CANCELLATION_REASON_MAX_LENGTH);

    await expect(validate(CancelLessonDto, { reason })).resolves.toEqual({
      reason,
    });
  });

  it.each([
    ['empty', '', REQUIRED_FIELD_MESSAGE],
    ['whitespace only', '   ', REQUIRED_FIELD_MESSAGE],
    ['null', null, 'reason має бути рядком.'],
    ['a number', 123, 'reason має бути рядком.'],
    [
      'too long',
      'а'.repeat(CANCELLATION_REASON_MAX_LENGTH + 1),
      CANCELLATION_REASON_LENGTH_MESSAGE,
    ],
    ['markup', '<b>Захворів</b>', UNSAFE_TEXT_MESSAGE],
  ])('rejects a reason that is %s', async (_, reason, message) => {
    await expect(errorsFor(CancelLessonDto, { reason })).resolves.toEqual(
      fieldErrors('reason', message),
    );
  });

  it.each(['status', 'cancelledAt', 'cancelledById'])(
    'rejects %s in the body',
    async (field) => {
      await expect(
        errorsFor(CancelLessonDto, { [field]: 'x' }),
      ).resolves.toEqual(
        fieldErrors(field, `property ${field} should not exist`),
      );
    },
  );
});
