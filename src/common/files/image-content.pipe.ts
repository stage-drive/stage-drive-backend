import { Injectable, PipeTransform } from '@nestjs/common';
import { open } from 'fs/promises';
import { fieldBadRequest } from '../validation/field-error';
import {
  IMAGE_CONTENT_MESSAGE,
  IMAGE_SIGNATURE_LENGTH,
  matchesImageSignature,
} from './image-upload';

async function readSignature(path: string): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(IMAGE_SIGNATURE_LENGTH);
    const { bytesRead } = await handle.read(
      buffer,
      0,
      IMAGE_SIGNATURE_LENGTH,
      0,
    );
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Перевіряє, що вміст файлу справді є зображенням заявленого типу.
 * MIME-тип у multipart задає клієнт, тож сам по собі він нічого не гарантує.
 * Файл, який не пройшов перевірку, видаляє ImageUploadInterceptor.
 */
@Injectable()
export class ImageContentPipe implements PipeTransform<
  Express.Multer.File | undefined,
  Promise<Express.Multer.File | undefined>
> {
  async transform(
    file: Express.Multer.File | undefined,
  ): Promise<Express.Multer.File | undefined> {
    if (!file) {
      return file;
    }
    const signature = await readSignature(file.path);
    if (!matchesImageSignature(file.mimetype, signature)) {
      throw fieldBadRequest(file.fieldname, IMAGE_CONTENT_MESSAGE);
    }
    return file;
  }
}
