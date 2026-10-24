import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { validationExceptionFactory } from '../../common/validation/field-error';
import {
  ATTENDANCE_DUPLICATE_STUDENT_MESSAGE,
  ATTENDANCE_MAX_RECORDS,
  ATTENDANCE_RECORDS_MESSAGE,
  ATTENDANCE_STATUS_VALUE_MESSAGE,
  UpdateLessonAttendanceDto,
} from './lesson-attendance.dto';
import { REQUIRED_FIELD_MESSAGE } from './lessons.dto';

// Same options as configureApp, so the DTO is checked the way the API runs it.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  stopAtFirstError: true,
  exceptionFactory: validationExceptionFactory,
});

function validate(value: unknown): Promise<unknown> {
  return pipe.transform(value, {
    type: 'body',
    metatype: UpdateLessonAttendanceDto,
  });
}

async function errorsFor(value: unknown): Promise<unknown> {
  try {
    await validate(value);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse();
  }
  throw new Error('Expected validation to fail');
}

function fieldErrors(field: string, message: string) {
  return { statusCode: 400, errors: [{ field, message }] };
}

function studentId(n: number): string {
  return `77aa0000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
}

describe('UpdateLessonAttendanceDto', () => {
  it('accepts one record', async () => {
    const body = { records: [{ studentId: studentId(1), status: 'PRESENT' }] };

    await expect(validate(body)).resolves.toEqual(body);
  });

  it.each(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'])(
    'accepts status %s',
    async (status) => {
      await expect(
        validate({ records: [{ studentId: studentId(1), status }] }),
      ).resolves.toBeInstanceOf(UpdateLessonAttendanceDto);
    },
  );

  it(`accepts ${ATTENDANCE_MAX_RECORDS} distinct students`, async () => {
    const records = Array.from({ length: ATTENDANCE_MAX_RECORDS }, (_, i) => ({
      studentId: studentId(i),
      status: 'ABSENT',
    }));

    await expect(validate({ records })).resolves.toEqual({ records });
  });

  it('requires records', async () => {
    await expect(errorsFor({})).resolves.toEqual(
      fieldErrors('records', REQUIRED_FIELD_MESSAGE),
    );
  });

  it.each([
    ['an empty array', []],
    ['an object', {}],
    ['a string', 'PRESENT'],
    ['null', null],
    [
      `${ATTENDANCE_MAX_RECORDS + 1} records`,
      Array.from({ length: ATTENDANCE_MAX_RECORDS + 1 }, (_, i) => ({
        studentId: studentId(i),
        status: 'PRESENT',
      })),
    ],
  ])('rejects %s as records', async (_, records) => {
    const expected =
      records === null
        ? fieldErrors('records', REQUIRED_FIELD_MESSAGE)
        : fieldErrors('records', ATTENDANCE_RECORDS_MESSAGE);

    await expect(errorsFor({ records })).resolves.toEqual(expected);
  });

  it('rejects the same student twice', async () => {
    await expect(
      errorsFor({
        records: [
          { studentId: studentId(1), status: 'PRESENT' },
          { studentId: studentId(1), status: 'ABSENT' },
        ],
      }),
    ).resolves.toEqual(
      fieldErrors('records', ATTENDANCE_DUPLICATE_STUDENT_MESSAGE),
    );
  });

  it.each([
    ['null', null],
    ['a number', 5],
    ['a string', 'PRESENT'],
  ])('rejects %s as a record with a 400, not a crash', async (_, record) => {
    const response = await errorsFor({ records: [record] });

    expect(response).toMatchObject({
      statusCode: 400,
      errors: [{ field: 'records.0' }],
    });
  });

  it('does not report two broken records as duplicates', async () => {
    const response = await errorsFor({ records: [{}, {}] });

    expect(response).toMatchObject({
      statusCode: 400,
      errors: expect.arrayContaining([
        { field: 'records.0.studentId', message: REQUIRED_FIELD_MESSAGE },
      ]) as unknown,
    });
  });

  it.each([
    [
      'studentId is not a UUID',
      { studentId: 'student-1', status: 'PRESENT' },
      'records.0.studentId',
      'studentId має бути UUID.',
    ],
    [
      'studentId is missing',
      { status: 'PRESENT' },
      'records.0.studentId',
      REQUIRED_FIELD_MESSAGE,
    ],
    [
      'status is lowercase',
      { studentId: studentId(1), status: 'present' },
      'records.0.status',
      ATTENDANCE_STATUS_VALUE_MESSAGE,
    ],
    [
      'status is unknown',
      { studentId: studentId(1), status: 'SICK' },
      'records.0.status',
      ATTENDANCE_STATUS_VALUE_MESSAGE,
    ],
    [
      'status is null',
      { studentId: studentId(1), status: null },
      'records.0.status',
      REQUIRED_FIELD_MESSAGE,
    ],
  ])('rejects a record where %s', async (_, record, field, message) => {
    await expect(errorsFor({ records: [record] })).resolves.toEqual(
      fieldErrors(field, message),
    );
  });

  it('points at the broken record by its index', async () => {
    await expect(
      errorsFor({
        records: [
          { studentId: studentId(1), status: 'PRESENT' },
          { studentId: studentId(2), status: 'GONE' },
        ],
      }),
    ).resolves.toEqual(
      fieldErrors('records.1.status', ATTENDANCE_STATUS_VALUE_MESSAGE),
    );
  });

  it.each([
    [
      'a field inside a record',
      {
        records: [
          { studentId: studentId(1), status: 'PRESENT', markedAt: 'now' },
        ],
      },
      'records.0.markedAt',
    ],
    [
      'a scope field next to records',
      {
        organizationId: studentId(9),
        records: [{ studentId: studentId(1), status: 'PRESENT' }],
      },
      'organizationId',
    ],
  ])('rejects %s', async (_, body, field) => {
    const response = await errorsFor(body);

    expect(response).toMatchObject({
      statusCode: 400,
      errors: [{ field: expect.stringContaining(field) as unknown }],
    });
  });
});
