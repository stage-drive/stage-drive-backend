import { BadRequestException, Type, ValidationPipe } from '@nestjs/common';
import { validationExceptionFactory } from '../../common/validation/field-error';
import { REQUIRED_FIELD_MESSAGE } from '../courses/courses.dto';
import {
  OPTION_IDS_MESSAGE,
  QUESTION_ID_MESSAGE,
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

  it('rejects a missing answers array', async () => {
    await expect(errorsFor(SubmitAttemptDto, {})).resolves.toEqual({
      statusCode: 400,
      errors: [{ field: 'answers', message: REQUIRED_FIELD_MESSAGE }],
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
});
