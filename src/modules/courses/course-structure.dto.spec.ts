import { BadRequestException, Type, ValidationPipe } from '@nestjs/common';
import { CourseMaterialType } from '@prisma/client';
import { validationExceptionFactory } from '../../common/validation/field-error';
import { UNSAFE_TEXT_MESSAGE } from '../../common/validators/plain-text.decorator';
import {
  CreateChapterDto,
  CreateLessonDto,
  CreateMaterialDto,
  MATERIAL_BODY_LENGTH_MESSAGE,
  MATERIAL_BODY_MAX_LENGTH,
  MATERIAL_TYPE_MESSAGE,
  POSITION_INTEGER_MESSAGE,
  POSITION_MIN_MESSAGE,
  STRUCTURE_TITLE_LENGTH_MESSAGE,
  UpdateChapterDto,
  UpdateMaterialDto,
} from './course-structure.dto';
import { REQUIRED_FIELD_MESSAGE } from './courses.dto';

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

describe('course structure DTOs', () => {
  it('trims a chapter and stores a blank description as null', async () => {
    await expect(
      validate(CreateChapterDto, {
        title: '  Правила дорожнього руху  ',
        description: '   ',
        position: 2,
      }),
    ).resolves.toEqual({
      title: 'Правила дорожнього руху',
      description: null,
      position: 2,
    });
  });

  it('rejects an empty chapter title and a non-positive position', async () => {
    await expect(
      errorsFor(CreateChapterDto, { title: '   ' }),
    ).resolves.toEqual(fieldErrors('title', REQUIRED_FIELD_MESSAGE));
    await expect(
      errorsFor(CreateChapterDto, { title: 'Розділ', position: 0 }),
    ).resolves.toEqual(fieldErrors('position', POSITION_MIN_MESSAGE));
    await expect(
      errorsFor(CreateChapterDto, { title: 'Розділ', position: 1.5 }),
    ).resolves.toEqual(fieldErrors('position', POSITION_INTEGER_MESSAGE));
  });

  it('rejects courseId in the body and unsafe text', async () => {
    await expect(
      errorsFor(CreateLessonDto, {
        title: 'Урок',
        courseId: '41414141-4141-4414-8414-414141414141',
      }),
    ).resolves.toEqual(
      fieldErrors('courseId', 'property courseId should not exist'),
    );
    await expect(
      errorsFor(CreateLessonDto, { title: '<script>' }),
    ).resolves.toEqual(fieldErrors('title', UNSAFE_TEXT_MESSAGE));
  });

  it('lets an empty chapter update through and clears the description', async () => {
    await expect(validate(UpdateChapterDto, {})).resolves.toEqual({});
    await expect(
      validate(UpdateChapterDto, { description: null }),
    ).resolves.toEqual({ description: null });
  });

  it('accepts a link material and rejects an unknown type', async () => {
    await expect(
      validate(CreateMaterialDto, {
        title: '  Офіційні ПДР  ',
        type: CourseMaterialType.LINK,
        body: '  https://example.com/pdr  ',
      }),
    ).resolves.toEqual({
      title: 'Офіційні ПДР',
      type: CourseMaterialType.LINK,
      body: 'https://example.com/pdr',
    });

    await expect(
      errorsFor(CreateMaterialDto, { title: 'Матеріал', type: 'AUDIO' }),
    ).resolves.toEqual(fieldErrors('type', MATERIAL_TYPE_MESSAGE));
  });

  it('rejects an oversized material body and a title that is too long', async () => {
    await expect(
      errorsFor(UpdateMaterialDto, {
        body: 'а'.repeat(MATERIAL_BODY_MAX_LENGTH + 1),
      }),
    ).resolves.toEqual(fieldErrors('body', MATERIAL_BODY_LENGTH_MESSAGE));
    await expect(
      errorsFor(CreateChapterDto, { title: 'а'.repeat(201) }),
    ).resolves.toEqual(fieldErrors('title', STRUCTURE_TITLE_LENGTH_MESSAGE));
  });
});
