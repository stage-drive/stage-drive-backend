import { BadRequestException, Type, ValidationPipe } from '@nestjs/common';
import { validationExceptionFactory } from '../../common/validation/field-error';
import { REQUIRED_FIELD_MESSAGE } from '../courses/courses.dto';
import {
  ANSWERS_ARRAY_MESSAGE,
  ATTEMPT_GROUP_ID_MESSAGE,
  ATTEMPT_LESSON_ID_MESSAGE,
  ATTEMPT_RESULT_FILTER_MESSAGE,
  ATTEMPT_STATUS_FILTER_MESSAGE,
  ATTEMPT_STUDENT_ID_MESSAGE,
  ATTEMPT_TEST_ID_MESSAGE,
  MyTestAttemptsQueryDto,
  OPTION_IDS_MESSAGE,
  QUESTION_ID_MESSAGE,
  SaveAttemptAnswersDto,
  StaffAllTestAttemptsQueryDto,
  StaffTestAttemptsQueryDto,
  SubmitAttemptDto,
} from './test-attempts.dto';

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

describe('SubmitAttemptDto', () => {
  const questionId = '71717171-7171-4717-8717-717171717171';
  const optionId = '81818181-8181-4818-8818-818181818181';

  it('keeps question and option ids', async () => {
    await expect(
      validate(SubmitAttemptDto, {
        answers: [{ questionId, optionIds: [optionId] }],
      }),
    ).resolves.toEqual({
      answers: [{ questionId, optionIds: [optionId] }],
    });
  });

  it('allows an empty answer list', async () => {
    await expect(validate(SubmitAttemptDto, { answers: [] })).resolves.toEqual({
      answers: [],
    });
  });

  it('allows a missing answers array: the server then grades the saved answers', async () => {
    await expect(validate(SubmitAttemptDto, {})).resolves.toEqual({});
  });

  it('rejects answers that are not an array', async () => {
    await expect(
      errorsFor(SubmitAttemptDto, { answers: 'all' }),
    ).resolves.toEqual({
      statusCode: 400,
      errors: [{ field: 'answers', message: ANSWERS_ARRAY_MESSAGE }],
    });
  });

  it('rejects a question id that is not a uuid', async () => {
    await expect(
      errorsFor(SubmitAttemptDto, {
        answers: [{ questionId: 'question', optionIds: [] }],
      }),
    ).resolves.toEqual({
      statusCode: 400,
      errors: [{ field: 'answers.0.questionId', message: QUESTION_ID_MESSAGE }],
    });
  });

  it('rejects an option id that is not a uuid', async () => {
    await expect(
      errorsFor(SubmitAttemptDto, {
        answers: [{ questionId, optionIds: ['option'] }],
      }),
    ).resolves.toEqual({
      statusCode: 400,
      errors: [{ field: 'answers.0.optionIds', message: OPTION_IDS_MESSAGE }],
    });
  });

  it.each([
    ['score', 100],
    ['scorePercent', 100],
    ['passed', true],
    ['result', 'PASSED'],
    ['status', 'PASSED'],
  ])(
    'never accepts the grade from the client: rejects %s',
    async (field, value) => {
      await expect(
        errorsFor(SubmitAttemptDto, { answers: [], [field]: value }),
      ).resolves.toMatchObject({
        statusCode: 400,
        errors: [{ field }],
      });
    },
  );
});

describe('SaveAttemptAnswersDto', () => {
  const questionId = '71717171-7171-4717-8717-717171717171';
  const optionId = '81818181-8181-4818-8818-818181818181';

  it('keeps the answers to save', async () => {
    await expect(
      validate(SaveAttemptAnswersDto, {
        answers: [{ questionId, optionIds: [optionId] }],
      }),
    ).resolves.toEqual({ answers: [{ questionId, optionIds: [optionId] }] });
  });

  it('allows an empty optionIds, which clears the saved answer', async () => {
    await expect(
      validate(SaveAttemptAnswersDto, {
        answers: [{ questionId, optionIds: [] }],
      }),
    ).resolves.toEqual({ answers: [{ questionId, optionIds: [] }] });
  });

  it('requires the answers array, unlike submit', async () => {
    await expect(errorsFor(SaveAttemptAnswersDto, {})).resolves.toEqual({
      statusCode: 400,
      errors: [{ field: 'answers', message: REQUIRED_FIELD_MESSAGE }],
    });
  });

  it('requires optionIds in every answer', async () => {
    await expect(
      errorsFor(SaveAttemptAnswersDto, { answers: [{ questionId }] }),
    ).resolves.toEqual({
      statusCode: 400,
      errors: [
        { field: 'answers.0.optionIds', message: REQUIRED_FIELD_MESSAGE },
      ],
    });
  });

  it('rejects an option id that is not a uuid', async () => {
    await expect(
      errorsFor(SaveAttemptAnswersDto, {
        answers: [{ questionId, optionIds: ['option'] }],
      }),
    ).resolves.toEqual({
      statusCode: 400,
      errors: [{ field: 'answers.0.optionIds', message: OPTION_IDS_MESSAGE }],
    });
  });
});

describe('attempt list queries', () => {
  const uuid = '91919191-9191-4919-8919-919191919191';

  describe.each([
    ['MyTestAttemptsQueryDto', MyTestAttemptsQueryDto],
    ['StaffTestAttemptsQueryDto', StaffTestAttemptsQueryDto],
    ['StaffAllTestAttemptsQueryDto', StaffAllTestAttemptsQueryDto],
  ] as const)('%s', (_name, metatype) => {
    it('accepts an empty query', async () => {
      await expect(validate(metatype, {})).resolves.toEqual({});
    });

    it('turns page and limit from the query string into numbers', async () => {
      await expect(
        validate(metatype, { page: '2', limit: '50' }),
      ).resolves.toEqual({ page: 2, limit: 50 });
    });

    it.each([
      [{ page: '0' }, 'page', 'page має бути не менше 1.'],
      [{ page: '1.5' }, 'page', 'page має бути цілим числом.'],
      [{ limit: '0' }, 'limit', 'limit має бути не менше 1.'],
      [{ limit: '101' }, 'limit', 'limit має бути не більше 100.'],
    ])('rejects %j', async (query, field, message) => {
      await expect(errorsFor(metatype, query)).resolves.toEqual({
        statusCode: 400,
        errors: [{ field, message }],
      });
    });

    it.each(['page', 'limit'])('rejects a non-numeric %s', async (field) => {
      await expect(
        errorsFor(metatype, { [field]: 'many' }),
      ).resolves.toMatchObject({ statusCode: 400, errors: [{ field }] });
    });

    it('treats empty filters as absent', async () => {
      await expect(
        validate(metatype, { status: '', result: '' }),
      ).resolves.toEqual({});
    });

    it.each(['IN_PROGRESS', 'COMPLETED', 'EXPIRED'])(
      'accepts the status filter %s',
      async (status) => {
        await expect(validate(metatype, { status })).resolves.toEqual({
          status,
        });
      },
    );

    it.each(['PASSED', 'FAILED'])(
      'accepts the result filter %s',
      async (result) => {
        await expect(validate(metatype, { result })).resolves.toEqual({
          result,
        });
      },
    );

    it('rejects a status that is not a status of the API', async () => {
      // PASSED і FAILED — це результат, а не статус: у API вони йдуть як COMPLETED + result.
      await expect(errorsFor(metatype, { status: 'PASSED' })).resolves.toEqual({
        statusCode: 400,
        errors: [{ field: 'status', message: ATTEMPT_STATUS_FILTER_MESSAGE }],
      });
    });

    it('rejects a result that is not PASSED or FAILED', async () => {
      await expect(
        errorsFor(metatype, { result: 'COMPLETED' }),
      ).resolves.toEqual({
        statusCode: 400,
        errors: [{ field: 'result', message: ATTEMPT_RESULT_FILTER_MESSAGE }],
      });
    });
  });

  describe('MyTestAttemptsQueryDto', () => {
    it('keeps the test and lesson filters', async () => {
      await expect(
        validate(MyTestAttemptsQueryDto, { testId: uuid, lessonId: uuid }),
      ).resolves.toEqual({ testId: uuid, lessonId: uuid });
    });

    it.each([
      ['testId', ATTEMPT_TEST_ID_MESSAGE],
      ['lessonId', ATTEMPT_LESSON_ID_MESSAGE],
    ])('rejects a %s that is not a uuid', async (field, message) => {
      await expect(
        errorsFor(MyTestAttemptsQueryDto, { [field]: 'not-a-uuid' }),
      ).resolves.toEqual({ statusCode: 400, errors: [{ field, message }] });
    });

    it.each(['groupId', 'studentId'])(
      'does not let a student ask for the attempts of others: rejects %s',
      async (field) => {
        await expect(
          errorsFor(MyTestAttemptsQueryDto, { [field]: uuid }),
        ).resolves.toMatchObject({ statusCode: 400, errors: [{ field }] });
      },
    );
  });

  describe('StaffTestAttemptsQueryDto', () => {
    it('keeps the group and student filters', async () => {
      await expect(
        validate(StaffTestAttemptsQueryDto, { groupId: uuid, studentId: uuid }),
      ).resolves.toEqual({ groupId: uuid, studentId: uuid });
    });

    it.each([
      ['groupId', ATTEMPT_GROUP_ID_MESSAGE],
      ['studentId', ATTEMPT_STUDENT_ID_MESSAGE],
    ])('rejects a %s that is not a uuid', async (field, message) => {
      await expect(
        errorsFor(StaffTestAttemptsQueryDto, { [field]: 'not-a-uuid' }),
      ).resolves.toEqual({ statusCode: 400, errors: [{ field, message }] });
    });

    it('takes the test from the path, not from the query', async () => {
      await expect(
        errorsFor(StaffTestAttemptsQueryDto, { testId: uuid }),
      ).resolves.toMatchObject({
        statusCode: 400,
        errors: [{ field: 'testId' }],
      });
    });
  });

  describe('StaffAllTestAttemptsQueryDto', () => {
    it('adds the test filter to the staff ones', async () => {
      await expect(
        validate(StaffAllTestAttemptsQueryDto, {
          testId: uuid,
          groupId: uuid,
          studentId: uuid,
          status: 'COMPLETED',
          result: 'FAILED',
        }),
      ).resolves.toEqual({
        testId: uuid,
        groupId: uuid,
        studentId: uuid,
        status: 'COMPLETED',
        result: 'FAILED',
      });
    });

    it('rejects a testId that is not a uuid', async () => {
      await expect(
        errorsFor(StaffAllTestAttemptsQueryDto, { testId: 'not-a-uuid' }),
      ).resolves.toEqual({
        statusCode: 400,
        errors: [{ field: 'testId', message: ATTEMPT_TEST_ID_MESSAGE }],
      });
    });
  });
});
