import { BadRequestException, Type, ValidationPipe } from '@nestjs/common';
import { TheoryTestFormat, TheoryTestPublicationStatus } from '@prisma/client';
import { validationExceptionFactory } from '../../common/validation/field-error';
import { REQUIRED_FIELD_MESSAGE } from '../courses/courses.dto';
import {
  COURSE_ID_MESSAGE,
  CreateQuestionDto,
  CreateTestDto,
  PASSING_SCORE_MESSAGE,
  TEST_FORMAT_MESSAGE,
  TEST_PUBLICATION_MESSAGE,
  UpdateTestDto,
  UpdateTestPublicationDto,
} from './tests.dto';

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

describe('CreateTestDto', () => {
  const valid = {
    courseId: '41414141-4141-4414-8414-414141414141',
    name: 'ПДР, категорія B',
    format: TheoryTestFormat.SINGLE_CHOICE,
    passingScore: 90,
    timeLimitMinutes: 20,
    shuffleQuestions: false,
  };

  it('trims the name and keeps the main parameters', async () => {
    await expect(
      validate(CreateTestDto, { ...valid, name: '  ПДР, категорія B  ' }),
    ).resolves.toMatchObject({
      name: valid.name,
      format: TheoryTestFormat.SINGLE_CHOICE,
      passingScore: 90,
      timeLimitMinutes: 20,
      shuffleQuestions: false,
    });
  });

  it('stores an empty description as null', async () => {
    await expect(
      validate(CreateTestDto, { ...valid, description: '   ' }),
    ).resolves.toMatchObject({ description: null });
  });

  it('rejects a missing name', async () => {
    const { name: _name, ...body } = valid;
    await expect(errorsFor(CreateTestDto, body)).resolves.toEqual(
      fieldErrors('name', REQUIRED_FIELD_MESSAGE),
    );
  });

  it('rejects a course id that is not a uuid', async () => {
    await expect(
      errorsFor(CreateTestDto, { ...valid, courseId: 'course' }),
    ).resolves.toEqual(fieldErrors('courseId', COURSE_ID_MESSAGE));
  });

  it('rejects an unknown format', async () => {
    await expect(
      errorsFor(CreateTestDto, { ...valid, format: 'OPEN' }),
    ).resolves.toEqual(fieldErrors('format', TEST_FORMAT_MESSAGE));
  });

  it('rejects a passing score outside 1..100', async () => {
    await expect(
      errorsFor(CreateTestDto, { ...valid, passingScore: 0 }),
    ).resolves.toEqual(fieldErrors('passingScore', PASSING_SCORE_MESSAGE));
  });

  it('rejects organizationId in the body', async () => {
    const response = await errorsFor(CreateTestDto, {
      ...valid,
      organizationId: '41414141-4141-4414-8414-414141414141',
    });
    expect(response).toMatchObject({ statusCode: 400 });
  });
});

describe('UpdateTestDto', () => {
  it('rejects an empty name', async () => {
    await expect(errorsFor(UpdateTestDto, { name: '   ' })).resolves.toEqual(
      fieldErrors('name', REQUIRED_FIELD_MESSAGE),
    );
  });
});

describe('UpdateTestPublicationDto', () => {
  it('accepts PUBLISHED', async () => {
    await expect(
      validate(UpdateTestPublicationDto, {
        publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
      }),
    ).resolves.toEqual({
      publicationStatus: TheoryTestPublicationStatus.PUBLISHED,
    });
  });

  it('rejects an unknown publication status', async () => {
    await expect(
      errorsFor(UpdateTestPublicationDto, { publicationStatus: 'LIVE' }),
    ).resolves.toEqual(
      fieldErrors('publicationStatus', TEST_PUBLICATION_MESSAGE),
    );
  });
});

describe('CreateQuestionDto', () => {
  it('requires the question text and a correct flag on each option', async () => {
    await expect(errorsFor(CreateQuestionDto, {})).resolves.toEqual(
      fieldErrors('text', REQUIRED_FIELD_MESSAGE),
    );
    await expect(
      errorsFor(CreateQuestionDto, {
        text: 'Що означає цей знак?',
        options: [{ text: 'Поступитися' }],
      }),
    ).resolves.toEqual(
      fieldErrors('options.0.isCorrect', REQUIRED_FIELD_MESSAGE),
    );
  });

  it('accepts a question with options', async () => {
    await expect(
      validate(CreateQuestionDto, {
        text: '  Що означає цей знак?  ',
        options: [
          { text: 'Поступитися', isCorrect: true },
          { text: 'Зупинитися', isCorrect: false },
        ],
      }),
    ).resolves.toMatchObject({
      text: 'Що означає цей знак?',
      options: [
        { text: 'Поступитися', isCorrect: true },
        { text: 'Зупинитися', isCorrect: false },
      ],
    });
  });
});
