import { BadRequestException, Type, ValidationPipe } from '@nestjs/common';
import { validationExceptionFactory } from '../../common/validation/field-error';
import { UNSAFE_TEXT_MESSAGE } from '../../common/validators/plain-text.decorator';
import {
  CANCELLATION_REASON_LENGTH_MESSAGE,
  CANCELLATION_REASON_MAX_LENGTH,
  CancelLessonDto,
  CreatePracticeLessonDto,
  CreateTheoryLessonDto,
  INCLUDE_CANCELLED_MESSAGE,
  LESSON_DURATION_MESSAGE,
  LESSON_TOPIC_LENGTH_MESSAGE,
  LESSON_TOPIC_MAX_LENGTH,
  LESSON_TYPE_MESSAGE,
  PersonalScheduleQueryDto,
  REQUIRED_FIELD_MESSAGE,
  RescheduleLessonDto,
  SCHEDULE_RANGE_FORMAT_MESSAGE,
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

const INSTRUCTOR_ID = 'a3b2c1d0-0000-4000-8000-000000000000';
const CAR_ID = 'c7d2e1f0-0000-4000-8000-000000000000';
const GROUP_ID = '4c21a0b0-0000-4000-8000-000000000000';
const STUDENT_ID = '77aa0000-0000-4000-8000-000000000000';

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

describe('CreateTheoryLessonDto', () => {
  const body = {
    groupId: GROUP_ID,
    topic: 'Дорожні знаки',
    scheduledAt: '2026-11-03T18:00:00+02:00',
  };

  it('accepts a body without durationMin and leaves it undefined', async () => {
    await expect(validate(CreateTheoryLessonDto, body)).resolves.toEqual(body);
  });

  it('trims the topic and keeps durationMin', async () => {
    await expect(
      validate(CreateTheoryLessonDto, {
        ...body,
        topic: '  Дорожні знаки  ',
        durationMin: 45,
      }),
    ).resolves.toEqual({ ...body, durationMin: 45 });
  });

  it.each(['groupId', 'topic', 'scheduledAt'])('requires %s', async (field) => {
    const rest: Record<string, unknown> = { ...body };
    delete rest[field];

    await expect(errorsFor(CreateTheoryLessonDto, rest)).resolves.toEqual(
      fieldErrors(field, REQUIRED_FIELD_MESSAGE),
    );
  });

  it.each(['groupId', 'topic', 'scheduledAt'])(
    'rejects a null %s',
    async (field) => {
      await expect(
        errorsFor(CreateTheoryLessonDto, { ...body, [field]: null }),
      ).resolves.toEqual(fieldErrors(field, REQUIRED_FIELD_MESSAGE));
    },
  );

  it.each([
    ['groupId', 'abc', 'groupId має бути UUID.'],
    ['topic', '', REQUIRED_FIELD_MESSAGE],
    ['topic', '   ', REQUIRED_FIELD_MESSAGE],
    [
      'topic',
      'а'.repeat(LESSON_TOPIC_MAX_LENGTH + 1),
      LESSON_TOPIC_LENGTH_MESSAGE,
    ],
    ['topic', '<b>Знаки</b>', UNSAFE_TEXT_MESSAGE],
    ['scheduledAt', '2026-11-03T18:00:00', SCHEDULED_AT_FORMAT_MESSAGE],
    ['durationMin', 14, LESSON_DURATION_MESSAGE],
    ['durationMin', 241, LESSON_DURATION_MESSAGE],
    ['durationMin', '90', LESSON_DURATION_MESSAGE],
    ['durationMin', null, LESSON_DURATION_MESSAGE],
  ])('rejects %s = %p', async (field, value, message) => {
    await expect(
      errorsFor(CreateTheoryLessonDto, { ...body, [field]: value }),
    ).resolves.toEqual(fieldErrors(field, message));
  });

  it.each(['status', 'organizationId', 'teacherId'])(
    'rejects %s in the body',
    async (field) => {
      await expect(
        errorsFor(CreateTheoryLessonDto, { ...body, [field]: 'x' }),
      ).resolves.toEqual(
        fieldErrors(field, `property ${field} should not exist`),
      );
    },
  );
});

describe('CreatePracticeLessonDto', () => {
  const body = {
    studentId: STUDENT_ID,
    scheduledAt: '2026-11-03T10:00:00+02:00',
  };

  it('accepts only studentId and scheduledAt', async () => {
    await expect(validate(CreatePracticeLessonDto, body)).resolves.toEqual(
      body,
    );
  });

  it('accepts instructorId, carId and durationMin', async () => {
    const full = {
      ...body,
      instructorId: INSTRUCTOR_ID,
      carId: CAR_ID,
      durationMin: 90,
    };

    await expect(validate(CreatePracticeLessonDto, full)).resolves.toEqual(
      full,
    );
  });

  it.each([
    ['studentId', undefined, REQUIRED_FIELD_MESSAGE],
    ['studentId', null, REQUIRED_FIELD_MESSAGE],
    ['studentId', 'abc', 'studentId має бути UUID.'],
    ['scheduledAt', undefined, REQUIRED_FIELD_MESSAGE],
    ['scheduledAt', '2026-11-03', SCHEDULED_AT_FORMAT_MESSAGE],
    ['instructorId', null, 'instructorId має бути UUID.'],
    ['instructorId', 'abc', 'instructorId має бути UUID.'],
    ['carId', null, 'carId має бути UUID.'],
    ['durationMin', 60.5, LESSON_DURATION_MESSAGE],
  ])('rejects %s = %p', async (field, value, message) => {
    await expect(
      errorsFor(CreatePracticeLessonDto, { ...body, [field]: value }),
    ).resolves.toEqual(fieldErrors(field, message));
  });

  it.each(['organizationId', 'groupId', 'status'])(
    'rejects %s in the body',
    async (field) => {
      await expect(
        errorsFor(CreatePracticeLessonDto, { ...body, [field]: 'x' }),
      ).resolves.toEqual(
        fieldErrors(field, `property ${field} should not exist`),
      );
    },
  );
});

describe('PersonalScheduleQueryDto', () => {
  // Express hands query values over as strings (arrays when a key repeats).
  const query = (value: unknown) =>
    validate(PersonalScheduleQueryDto, value, 'query');
  const queryErrors = (value: unknown) =>
    errorsFor(PersonalScheduleQueryDto, value, 'query');

  it('lets an empty query through (the service fills the defaults)', async () => {
    await expect(query({})).resolves.toEqual({});
  });

  it('accepts a full query and turns includeCancelled into a boolean', async () => {
    await expect(
      query({
        from: '2026-11-02T00:00:00+02:00',
        to: '2026-11-09T00:00:00+02:00',
        type: 'PRACTICE',
        includeCancelled: 'true',
      }),
    ).resolves.toEqual({
      from: '2026-11-02T00:00:00+02:00',
      to: '2026-11-09T00:00:00+02:00',
      type: 'PRACTICE',
      includeCancelled: true,
    });
  });

  describe.each(['from', 'to'])('%s', (field) => {
    it.each([
      '2026-11-02T00:00:00+02:00',
      '2026-11-01T22:00:00Z',
      '2026-11-01T22:00:00.000Z',
      '2026-11-01T17:00:00-05:00',
    ])('accepts %s', async (value) => {
      await expect(query({ [field]: value })).resolves.toEqual({
        [field]: value,
      });
    });

    it.each([
      ['without an offset', '2026-11-02T00:00:00'],
      ['date only', '2026-11-02'],
      ['without seconds', '2026-11-02T00:00+02:00'],
      // An unencoded + arrives as a space.
      ['with + decoded as a space', '2026-11-02T00:00:00 02:00'],
      ['a non-existent date', '2026-02-30T00:00:00Z'],
      ['empty', ''],
      ['a non-ISO format', '02.11.2026 00:00'],
      ['repeated', ['2026-11-02T00:00:00Z', '2026-11-03T00:00:00Z']],
    ])('rejects a value %s', async (_, value) => {
      await expect(queryErrors({ [field]: value })).resolves.toEqual(
        fieldErrors(field, SCHEDULE_RANGE_FORMAT_MESSAGE),
      );
    });
  });

  it.each(['THEORY', 'PRACTICE'])('accepts type %s', async (type) => {
    await expect(query({ type })).resolves.toEqual({ type });
  });

  it.each(['theory', 'ALL', ''])('rejects type %p', async (type) => {
    await expect(queryErrors({ type })).resolves.toEqual(
      fieldErrors('type', LESSON_TYPE_MESSAGE),
    );
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('turns includeCancelled %p into %p', async (value, expected) => {
    await expect(query({ includeCancelled: value })).resolves.toEqual({
      includeCancelled: expected,
    });
  });

  it.each(['yes', '1', 'TRUE', ''])(
    'rejects includeCancelled %p',
    async (includeCancelled) => {
      await expect(queryErrors({ includeCancelled })).resolves.toEqual(
        fieldErrors('includeCancelled', INCLUDE_CANCELLED_MESSAGE),
      );
    },
  );

  it.each(['userId', 'groupId', 'organizationId', 'status'])(
    'rejects %s: the schedule always belongs to the token owner',
    async (field) => {
      await expect(queryErrors({ [field]: 'x' })).resolves.toEqual(
        fieldErrors(field, `property ${field} should not exist`),
      );
    },
  );
});
