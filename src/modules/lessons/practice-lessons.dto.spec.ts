import { BadRequestException, Type, ValidationPipe } from '@nestjs/common';
import { UNSAFE_TEXT_MESSAGE } from '../../common/validators/plain-text.decorator';
import { validationExceptionFactory } from '../../common/validation/field-error';
import {
  INCLUDE_CANCELLED_MESSAGE,
  MEETING_PLACE_LENGTH_MESSAGE,
  MEETING_PLACE_MAX_LENGTH,
  REQUIRED_FIELD_MESSAGE,
  SCHEDULE_RANGE_FORMAT_MESSAGE,
  SCHEDULED_AT_FORMAT_MESSAGE,
} from './lessons.dto';
import {
  AvailablePracticeSlotQueryDto,
  BookPracticeLessonDto,
  PracticeLessonListQueryDto,
} from './practice-lessons.dto';

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

const ID = '5b0c0000-0000-4000-8000-000000000000';

describe('PracticeLessonListQueryDto', () => {
  it('accepts filters and turns includeCancelled into a boolean', async () => {
    await expect(
      validate(
        PracticeLessonListQueryDto,
        {
          from: '2026-11-16T00:00:00+02:00',
          instructorId: ID,
          studentId: ID,
          includeCancelled: 'true',
        },
        'query',
      ),
    ).resolves.toEqual({
      from: '2026-11-16T00:00:00+02:00',
      instructorId: ID,
      studentId: ID,
      includeCancelled: true,
    });
  });

  it.each([
    ['instructorId', { instructorId: 'x' }, 'instructorId має бути UUID.'],
    ['studentId', { studentId: 'x' }, 'studentId має бути UUID.'],
    [
      'includeCancelled',
      { includeCancelled: 'yes' },
      INCLUDE_CANCELLED_MESSAGE,
    ],
    ['from', { from: '2026-11-16' }, SCHEDULE_RANGE_FORMAT_MESSAGE],
  ])('rejects a bad %s', async (field, query, message) => {
    await expect(
      errorsFor(PracticeLessonListQueryDto, query, 'query'),
    ).resolves.toEqual(fieldErrors(field, message));
  });
});

describe('AvailablePracticeSlotQueryDto', () => {
  it('accepts an empty query and a window', async () => {
    await expect(
      validate(AvailablePracticeSlotQueryDto, {}, 'query'),
    ).resolves.toEqual({});
    const query = {
      from: '2026-11-16T00:00:00+02:00',
      to: '2026-11-23T00:00:00+02:00',
    };
    await expect(
      validate(AvailablePracticeSlotQueryDto, query, 'query'),
    ).resolves.toEqual(query);
  });

  it.each(['instructorId', 'carId', 'studentId'] as const)(
    'rejects %s: the instructor and car come from the student profile',
    async (field) => {
      await expect(
        errorsFor(AvailablePracticeSlotQueryDto, { [field]: ID }, 'query'),
      ).resolves.toEqual(
        fieldErrors(field, `property ${field} should not exist`),
      );
    },
  );
});

describe('BookPracticeLessonDto', () => {
  it('accepts a start alone and trims the meeting place', async () => {
    await expect(
      validate(BookPracticeLessonDto, {
        scheduledAt: '2026-11-16T09:00:00+02:00',
      }),
    ).resolves.toEqual({ scheduledAt: '2026-11-16T09:00:00+02:00' });
    await expect(
      validate(BookPracticeLessonDto, {
        scheduledAt: '2026-11-16T09:00:00+02:00',
        meetingPlace: '  Біля метро  ',
      }),
    ).resolves.toEqual({
      scheduledAt: '2026-11-16T09:00:00+02:00',
      meetingPlace: 'Біля метро',
    });
  });

  it.each([
    [
      'missing start',
      { scheduledAt: undefined },
      'scheduledAt',
      REQUIRED_FIELD_MESSAGE,
    ],
    [
      'start without an offset',
      { scheduledAt: '2026-11-16T09:00:00' },
      'scheduledAt',
      SCHEDULED_AT_FORMAT_MESSAGE,
    ],
    [
      'blank meeting place',
      { meetingPlace: '   ' },
      'meetingPlace',
      REQUIRED_FIELD_MESSAGE,
    ],
    [
      'too long a meeting place',
      { meetingPlace: 'а'.repeat(MEETING_PLACE_MAX_LENGTH + 1) },
      'meetingPlace',
      MEETING_PLACE_LENGTH_MESSAGE,
    ],
    [
      'markup in the meeting place',
      { meetingPlace: '<script>' },
      'meetingPlace',
      UNSAFE_TEXT_MESSAGE,
    ],
  ])('rejects %s', async (_, body, field, message) => {
    await expect(
      errorsFor(BookPracticeLessonDto, {
        scheduledAt: '2026-11-16T09:00:00+02:00',
        ...body,
      }),
    ).resolves.toEqual(fieldErrors(field, message));
  });

  it.each(['instructorId', 'carId', 'durationMin'] as const)(
    'rejects %s: the student cannot choose it',
    async (field) => {
      const response = (await errorsFor(BookPracticeLessonDto, {
        scheduledAt: '2026-11-16T09:00:00+02:00',
        [field]: field === 'durationMin' ? 60 : ID,
      })) as { errors: { field: string }[] };

      expect(response.errors[0].field).toBe(field);
    },
  );
});
