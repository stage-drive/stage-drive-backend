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
  CONFIRMATION_STATUS_MESSAGE,
  INSTRUCTOR_COMMENT_LENGTH_MESSAGE,
  OUTCOME_RESULT_MESSAGE,
  PracticeLessonOutcomeDto,
  PracticeProgressQueryDto,
  STUDENT_ID_MESSAGE,
  UpdatePracticeCommentDto,
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

  it('accepts a confirmation status filter', async () => {
    await expect(
      validate(
        PracticeLessonListQueryDto,
        { confirmationStatus: 'PENDING' },
        'query',
      ),
    ).resolves.toEqual({ confirmationStatus: 'PENDING' });
  });

  it.each([
    [
      'confirmationStatus',
      { confirmationStatus: 'WAITING' },
      CONFIRMATION_STATUS_MESSAGE,
    ],
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

describe('PracticeLessonOutcomeDto', () => {
  it('accepts a result alone and trims a comment', async () => {
    await expect(
      validate(PracticeLessonOutcomeDto, { result: 'NO_SHOW' }),
    ).resolves.toEqual({ result: 'NO_SHOW' });
    await expect(
      validate(PracticeLessonOutcomeDto, {
        result: 'COMPLETED',
        comment: '  Добре  ',
      }),
    ).resolves.toEqual({ result: 'COMPLETED', comment: 'Добре' });
  });

  it.each([
    ['missing', {}, REQUIRED_FIELD_MESSAGE],
    ['scheduled', { result: 'SCHEDULED' }, OUTCOME_RESULT_MESSAGE],
    ['cancelled', { result: 'CANCELLED' }, OUTCOME_RESULT_MESSAGE],
    ['lower-case', { result: 'completed' }, OUTCOME_RESULT_MESSAGE],
  ])('rejects a %s result', async (_, body, message) => {
    await expect(errorsFor(PracticeLessonOutcomeDto, body)).resolves.toEqual(
      fieldErrors('result', message),
    );
  });

  it.each([
    ['blank', { comment: '   ' }, REQUIRED_FIELD_MESSAGE],
    [
      'too long',
      { comment: 'а'.repeat(1001) },
      INSTRUCTOR_COMMENT_LENGTH_MESSAGE,
    ],
    ['with markup', { comment: '<b>x</b>' }, UNSAFE_TEXT_MESSAGE],
  ])('rejects a %s comment', async (_, body, message) => {
    await expect(
      errorsFor(PracticeLessonOutcomeDto, { result: 'COMPLETED', ...body }),
    ).resolves.toEqual(fieldErrors('comment', message));
  });
});

describe('UpdatePracticeCommentDto', () => {
  it('requires a comment', async () => {
    await expect(errorsFor(UpdatePracticeCommentDto, {})).resolves.toEqual(
      fieldErrors('comment', REQUIRED_FIELD_MESSAGE),
    );
    await expect(
      validate(UpdatePracticeCommentDto, { comment: 'Місто' }),
    ).resolves.toEqual({ comment: 'Місто' });
  });
});

describe('PracticeProgressQueryDto', () => {
  it('accepts no studentId and a UUID, rejects anything else', async () => {
    await expect(
      validate(PracticeProgressQueryDto, {}, 'query'),
    ).resolves.toEqual({});
    await expect(
      validate(PracticeProgressQueryDto, { studentId: ID }, 'query'),
    ).resolves.toEqual({ studentId: ID });
    await expect(
      errorsFor(PracticeProgressQueryDto, { studentId: 'me' }, 'query'),
    ).resolves.toEqual(fieldErrors('studentId', STUDENT_ID_MESSAGE));
  });
});
