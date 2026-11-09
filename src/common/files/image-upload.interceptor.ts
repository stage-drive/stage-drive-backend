import {
  CallHandler,
  ExecutionContext,
  Logger,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Request } from 'express';
import { unlink } from 'fs/promises';
import { catchError, from, Observable, switchMap, throwError } from 'rxjs';
import { IMAGE_TOO_LARGE_MESSAGE } from './image-upload';

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

/**
 * Ставиться перед FileInterceptor у тому ж @UseInterceptors, тож обгортає
 * і multer, і пайпи, і сам обробник:
 * - якщо запит завершився помилкою після запису файлу (вміст не пройшов
 *   ImageContentPipe, невалідне тіло, збій бази), файл видаляється з диска;
 * - перевищення розміру від multer повертається у форматі { errors: [...] }.
 */
export class ImageUploadInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ImageUploadInterceptor.name);

  constructor(private readonly field: string) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    return next
      .handle()
      .pipe(
        catchError((error: unknown) =>
          from(this.removeUploadedFile(request.file)).pipe(
            switchMap(() => throwError(() => this.toUploadError(error))),
          ),
        ),
      );
  }

  private toUploadError(error: unknown): unknown {
    if (error instanceof PayloadTooLargeException) {
      return new PayloadTooLargeException({
        statusCode: 413,
        errors: [{ field: this.field, message: IMAGE_TOO_LARGE_MESSAGE }],
      });
    }
    return error;
  }

  private async removeUploadedFile(file?: Express.Multer.File): Promise<void> {
    if (!file?.path) {
      return;
    }
    try {
      await unlink(file.path);
    } catch (error) {
      if (!isMissingFile(error)) {
        this.logger.warn(
          `Failed to remove rejected upload path=${file.path}: ${String(error)}`,
        );
      }
    }
  }
}
