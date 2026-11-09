import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { existsSync } from 'fs';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { lastValueFrom, of, throwError } from 'rxjs';
import { IMAGE_TOO_LARGE_MESSAGE } from './image-upload';
import { ImageUploadInterceptor } from './image-upload.interceptor';

describe('ImageUploadInterceptor', () => {
  const interceptor = new ImageUploadInterceptor('file');
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'image-upload-interceptor-'));
    path = join(dir, 'upload.png');
    await writeFile(path, 'image');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function context(file?: Partial<Express.Multer.File>): ExecutionContext {
    const request = { file };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  function failingWith(error: unknown): CallHandler {
    return { handle: () => throwError(() => error) };
  }

  it('keeps the uploaded file when the request succeeds', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(context({ path }), {
        handle: () => of('ok'),
      }),
    );

    expect(result).toBe('ok');
    expect(existsSync(path)).toBe(true);
  });

  it('removes the uploaded file and rethrows when the request fails', async () => {
    const failure = new BadRequestException('invalid content');

    await expect(
      lastValueFrom(
        interceptor.intercept(context({ path }), failingWith(failure)),
      ),
    ).rejects.toBe(failure);
    expect(existsSync(path)).toBe(false);
  });

  it('removes the uploaded file when saving fails with a non-HTTP error', async () => {
    const failure = new Error('database is down');

    await expect(
      lastValueFrom(
        interceptor.intercept(context({ path }), failingWith(failure)),
      ),
    ).rejects.toBe(failure);
    expect(existsSync(path)).toBe(false);
  });

  it('rethrows the original error when there is no file to remove', async () => {
    const failure = new BadRequestException('no file');

    await expect(
      lastValueFrom(interceptor.intercept(context(), failingWith(failure))),
    ).rejects.toBe(failure);
  });

  it('rethrows the original error when the file is already gone', async () => {
    const failure = new BadRequestException('invalid content');
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await expect(
      lastValueFrom(
        interceptor.intercept(
          context({ path: join(dir, 'missing.png') }),
          failingWith(failure),
        ),
      ),
    ).rejects.toBe(failure);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('turns the multer size limit into a field error', async () => {
    const error = await lastValueFrom(
      interceptor.intercept(
        context(),
        failingWith(new PayloadTooLargeException('File too large')),
      ),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PayloadTooLargeException);
    expect((error as PayloadTooLargeException).getResponse()).toEqual({
      statusCode: 413,
      errors: [{ field: 'file', message: IMAGE_TOO_LARGE_MESSAGE }],
    });
  });
});
