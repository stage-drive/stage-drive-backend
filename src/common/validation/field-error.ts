import { BadRequestException, ValidationError } from '@nestjs/common';

export type FieldError = {
  field: string;
  message: string;
};

function collectFieldErrors(
  errors: ValidationError[],
  parentPath = '',
): FieldError[] {
  return errors.flatMap((error) => {
    const field = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;

    if (error.children?.length) {
      return collectFieldErrors(error.children, field);
    }

    const [message] = Object.values(error.constraints ?? {});
    return [{ field, message: message ?? 'Некоректне значення поля.' }];
  });
}

export function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    errors: collectFieldErrors(errors),
  });
}
