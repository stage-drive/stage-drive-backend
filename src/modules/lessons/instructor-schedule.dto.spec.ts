import { BadRequestException, Type, ValidationPipe } from '@nestjs/common';
import { UNSAFE_TEXT_MESSAGE } from '../../common/validators/plain-text.decorator';
import { validationExceptionFactory } from '../../common/validation/field-error';
import {
  CreateTimeOffDto,
  DAY_OF_WEEK_MESSAGE,
  ReplaceWorkingHoursDto,
  TIME_OFF_DATE_FORMAT_MESSAGE,
  TIME_OFF_INSTANT_FORMAT_MESSAGE,
  TIME_OFF_REASON_LENGTH_MESSAGE,
  TIME_OFF_REASON_MAX_LENGTH,
  TIME_OFF_TYPE_MESSAGE,
  TimeOffListQueryDto,
  WORKING_HOURS_END_FORMAT_MESSAGE,
  WORKING_HOURS_INTERVALS_MESSAGE,
  WORKING_HOURS_MAX_INTERVALS,
  WORKING_HOURS_START_FORMAT_MESSAGE,
} from './instructor-schedule.dto';
import {
  REQUIRED_FIELD_MESSAGE,
  SCHEDULE_RANGE_FORMAT_MESSAGE,
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

describe('ReplaceWorkingHoursDto', () => {
  const interval = { dayOfWeek: 'MONDAY', start: '09:00', end: '13:00' };

  it('accepts a week of intervals, an empty week and 24:00 as the end', async () => {
    await expect(
      validate(ReplaceWorkingHoursDto, {
        intervals: [
          interval,
          { dayOfWeek: 'MONDAY', start: '14:00', end: '24:00' },
        ],
      }),
    ).resolves.toEqual({
      intervals: [
        interval,
        { dayOfWeek: 'MONDAY', start: '14:00', end: '24:00' },
      ],
    });
    await expect(
      validate(ReplaceWorkingHoursDto, { intervals: [] }),
    ).resolves.toEqual({ intervals: [] });
  });

  it.each([
    ['missing', {}, 'intervals', REQUIRED_FIELD_MESSAGE],
    [
      'not an array',
      { intervals: 'MONDAY' },
      'intervals',
      WORKING_HOURS_INTERVALS_MESSAGE,
    ],
    [
      'too many items',
      {
        intervals: Array.from(
          { length: WORKING_HOURS_MAX_INTERVALS + 1 },
          () => interval,
        ),
      },
      'intervals',
      WORKING_HOURS_INTERVALS_MESSAGE,
    ],
  ])('rejects intervals that are %s', async (_, body, field, message) => {
    await expect(errorsFor(ReplaceWorkingHoursDto, body)).resolves.toEqual(
      fieldErrors(field, message),
    );
  });

  it.each([
    ['unknown day', { dayOfWeek: 'FUNDAY' }, 'dayOfWeek', DAY_OF_WEEK_MESSAGE],
    [
      'lower-case day',
      { dayOfWeek: 'monday' },
      'dayOfWeek',
      DAY_OF_WEEK_MESSAGE,
    ],
    [
      'missing day',
      { dayOfWeek: undefined },
      'dayOfWeek',
      REQUIRED_FIELD_MESSAGE,
    ],
    [
      'start without padding',
      { start: '9:00' },
      'start',
      WORKING_HOURS_START_FORMAT_MESSAGE,
    ],
    [
      'start at 24:00',
      { start: '24:00' },
      'start',
      WORKING_HOURS_START_FORMAT_MESSAGE,
    ],
    [
      'start with seconds',
      { start: '09:00:00' },
      'start',
      WORKING_HOURS_START_FORMAT_MESSAGE,
    ],
    [
      'start as a number',
      { start: 540 },
      'start',
      WORKING_HOURS_START_FORMAT_MESSAGE,
    ],
    [
      'end past midnight',
      { end: '24:30' },
      'end',
      WORKING_HOURS_END_FORMAT_MESSAGE,
    ],
    [
      'end with bad minutes',
      { end: '13:60' },
      'end',
      WORKING_HOURS_END_FORMAT_MESSAGE,
    ],
    ['missing end', { end: undefined }, 'end', REQUIRED_FIELD_MESSAGE],
  ])('rejects %s on the item path', async (_, override, field, message) => {
    await expect(
      errorsFor(ReplaceWorkingHoursDto, {
        intervals: [interval, { ...interval, ...override }],
      }),
    ).resolves.toEqual(fieldErrors(`intervals.1.${field}`, message));
  });

  it('rejects an unknown field inside an item', async () => {
    const response = (await errorsFor(ReplaceWorkingHoursDto, {
      intervals: [{ ...interval, carId: 'car-1' }],
    })) as { errors: { field: string }[] };

    expect(response.errors[0].field).toBe('intervals.0.carId');
  });
});

describe('CreateTimeOffDto', () => {
  it('accepts whole days and trims the reason', async () => {
    await expect(
      validate(CreateTimeOffDto, {
        type: 'VACATION',
        startDate: '2026-11-20',
        endDate: '2026-11-22',
        reason: '  Відпустка  ',
      }),
    ).resolves.toEqual({
      type: 'VACATION',
      startDate: '2026-11-20',
      endDate: '2026-11-22',
      reason: 'Відпустка',
    });
  });

  it('accepts exact instants with an offset', async () => {
    await expect(
      validate(CreateTimeOffDto, {
        startsAt: '2026-11-20T10:00:00+02:00',
        endsAt: '2026-11-20T12:00:00Z',
      }),
    ).resolves.toMatchObject({ startsAt: '2026-11-20T10:00:00+02:00' });
  });

  it.each([
    ['unknown type', { type: 'HOLIDAY' }, 'type', TIME_OFF_TYPE_MESSAGE],
    ['null type', { type: null }, 'type', TIME_OFF_TYPE_MESSAGE],
    [
      'date with time',
      { startDate: '2026-11-20T00:00:00Z' },
      'startDate',
      TIME_OFF_DATE_FORMAT_MESSAGE,
    ],
    [
      'impossible date',
      { startDate: '2026-02-30' },
      'startDate',
      TIME_OFF_DATE_FORMAT_MESSAGE,
    ],
    [
      'null endDate',
      { startDate: '2026-11-20', endDate: null },
      'endDate',
      TIME_OFF_DATE_FORMAT_MESSAGE,
    ],
    [
      'instant without offset',
      { startsAt: '2026-11-20T10:00:00' },
      'startsAt',
      TIME_OFF_INSTANT_FORMAT_MESSAGE,
    ],
    [
      'date as an instant',
      { endsAt: '2026-11-20' },
      'endsAt',
      TIME_OFF_INSTANT_FORMAT_MESSAGE,
    ],
    [
      'blank reason',
      { startDate: '2026-11-20', reason: '   ' },
      'reason',
      REQUIRED_FIELD_MESSAGE,
    ],
    [
      'too long a reason',
      {
        startDate: '2026-11-20',
        reason: 'а'.repeat(TIME_OFF_REASON_MAX_LENGTH + 1),
      },
      'reason',
      TIME_OFF_REASON_LENGTH_MESSAGE,
    ],
    [
      'markup in the reason',
      { startDate: '2026-11-20', reason: '<b>x</b>' },
      'reason',
      UNSAFE_TEXT_MESSAGE,
    ],
  ])('rejects %s', async (_, body, field, message) => {
    await expect(errorsFor(CreateTimeOffDto, body)).resolves.toEqual(
      fieldErrors(field, message),
    );
  });

  it('rejects an unknown field such as instructorId', async () => {
    const response = (await errorsFor(CreateTimeOffDto, {
      startDate: '2026-11-20',
      instructorId: 'instructor-1',
    })) as { errors: { field: string }[] };

    expect(response.errors[0].field).toBe('instructorId');
  });
});

describe('TimeOffListQueryDto', () => {
  it('accepts an empty query and zoned boundaries', async () => {
    await expect(validate(TimeOffListQueryDto, {}, 'query')).resolves.toEqual(
      {},
    );
    await expect(
      validate(
        TimeOffListQueryDto,
        { from: '2026-11-16T00:00:00+02:00', to: '2026-12-16T00:00:00+02:00' },
        'query',
      ),
    ).resolves.toMatchObject({ from: '2026-11-16T00:00:00+02:00' });
  });

  it('rejects a boundary without an offset', async () => {
    await expect(
      errorsFor(TimeOffListQueryDto, { from: '2026-11-16' }, 'query'),
    ).resolves.toEqual(fieldErrors('from', SCHEDULE_RANGE_FORMAT_MESSAGE));
  });
});
