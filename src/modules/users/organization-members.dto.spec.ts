import { BadRequestException, Type, ValidationPipe } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { validationExceptionFactory } from '../../common/validation/field-error';
import {
  ListOrganizationMembersQueryDto,
  UpdateOrganizationMemberDto,
  UpdateOrganizationMemberStatusDto,
} from './users.dto';

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

describe('organization member DTOs', () => {
  it('rejects email and role on the profile patch', async () => {
    await expect(
      errorsFor(UpdateOrganizationMemberDto, {
        firstName: 'Олена',
        email: 'new@example.com',
      }),
    ).resolves.toEqual({
      statusCode: 400,
      errors: [{ field: 'email', message: 'property email should not exist' }],
    });

    await expect(
      errorsFor(UpdateOrganizationMemberDto, {
        role: UserRole.ADMIN,
      }),
    ).resolves.toEqual({
      statusCode: 400,
      errors: [{ field: 'role', message: 'property role should not exist' }],
    });
  });

  it('accepts a name change and a cleared phone', async () => {
    await expect(
      validate(UpdateOrganizationMemberDto, {
        firstName: 'Олена',
        phone: null,
      }),
    ).resolves.toEqual({ firstName: 'Олена', phone: null });
  });

  it('rejects INVITED as a target status', async () => {
    await expect(
      errorsFor(UpdateOrganizationMemberStatusDto, {
        status: UserStatus.INVITED,
      }),
    ).resolves.toEqual({
      statusCode: 400,
      errors: [
        {
          field: 'status',
          message: 'status має бути ACTIVE, BLOCKED або ARCHIVED.',
        },
      ],
    });
  });

  it('accepts BLOCKED', async () => {
    await expect(
      validate(UpdateOrganizationMemberStatusDto, {
        status: UserStatus.BLOCKED,
      }),
    ).resolves.toEqual({ status: UserStatus.BLOCKED });
  });

  it('parses list query numbers and rejects page 0', async () => {
    await expect(
      pipe.transform(
        { page: '2', limit: '10', status: UserStatus.ARCHIVED },
        { type: 'query', metatype: ListOrganizationMembersQueryDto },
      ),
    ).resolves.toEqual({
      page: 2,
      limit: 10,
      status: UserStatus.ARCHIVED,
    });

    await expect(
      pipe
        .transform(
          { page: '0' },
          { type: 'query', metatype: ListOrganizationMembersQueryDto },
        )
        .catch((error: unknown) => {
          expect(error).toBeInstanceOf(BadRequestException);
          return (error as BadRequestException).getResponse();
        }),
    ).resolves.toEqual({
      statusCode: 400,
      errors: [{ field: 'page', message: 'page має бути не менше 1.' }],
    });
  });
});
