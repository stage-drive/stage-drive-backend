import { randomUUID } from 'crypto';
import { diskStorage, FileFilterCallback } from 'multer';
import { Request } from 'express';
import { CourseMaterialType } from '@prisma/client';
import { fieldBadRequest } from '../validation/field-error';
import { ensureUploadDir, matchesImageSignature } from './image-upload';

export const MATERIAL_UPLOAD_SUBDIR = 'materials';
export const MATERIAL_MAX_SIZE = 10 * 1024 * 1024;
export const MATERIAL_TYPE_FILE_MESSAGE =
  'Дозволені JPEG, PNG, WEBP, GIF, PDF, TXT, DOC і DOCX.';
export const MATERIAL_CONTENT_MESSAGE =
  'Вміст файлу не відповідає заявленому формату.';
export const MATERIAL_TOO_LARGE_MESSAGE =
  'Файл завеликий. Максимальний розмір — 10 МБ.';

const FILE_TYPES = new Map<
  string,
  { extension: string; type: CourseMaterialType }
>([
  ['image/jpeg', { extension: '.jpg', type: CourseMaterialType.IMAGE }],
  ['image/png', { extension: '.png', type: CourseMaterialType.IMAGE }],
  ['image/webp', { extension: '.webp', type: CourseMaterialType.IMAGE }],
  ['image/gif', { extension: '.gif', type: CourseMaterialType.IMAGE }],
  ['application/pdf', { extension: '.pdf', type: CourseMaterialType.PDF }],
  ['text/plain', { extension: '.txt', type: CourseMaterialType.FILE }],
  ['application/msword', { extension: '.doc', type: CourseMaterialType.FILE }],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    { extension: '.docx', type: CourseMaterialType.FILE },
  ],
]);

function startsWithAscii(header: Buffer, text: string): boolean {
  return (
    header.length >= text.length &&
    header.toString('ascii', 0, text.length) === text
  );
}

export function materialFilename(
  ownerId: string,
  mimetype: string,
): string | undefined {
  const type = FILE_TYPES.get(mimetype);
  return type ? `${ownerId}-${randomUUID()}${type.extension}` : undefined;
}

export function materialFileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback,
) {
  if (!FILE_TYPES.has(file.mimetype)) {
    cb(fieldBadRequest(file.fieldname, MATERIAL_TYPE_FILE_MESSAGE));
    return;
  }
  cb(null, true);
}

export function materialStorage(
  lessonId: (req: Request) => string | undefined,
) {
  return diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, ensureUploadDir(MATERIAL_UPLOAD_SUBDIR));
    },
    filename: (req, file, cb) => {
      const filename = materialFilename(
        lessonId(req) ?? 'lesson',
        file.mimetype,
      );
      if (!filename) {
        cb(fieldBadRequest(file.fieldname, MATERIAL_TYPE_FILE_MESSAGE), '');
        return;
      }
      cb(null, filename);
    },
  });
}

/** Перевіряє перші байти і повертає тип матеріалу. Інакше 400. */
export function assertMaterialFile(
  mimetype: string,
  header: Buffer,
): CourseMaterialType {
  const known = FILE_TYPES.get(mimetype);
  if (!known) {
    throw fieldBadRequest('file', MATERIAL_TYPE_FILE_MESSAGE);
  }
  if (known.type === CourseMaterialType.IMAGE) {
    if (!matchesImageSignature(mimetype, header)) {
      throw fieldBadRequest('file', MATERIAL_CONTENT_MESSAGE);
    }
    return known.type;
  }
  if (known.type === CourseMaterialType.PDF) {
    if (!startsWithAscii(header, '%PDF')) {
      throw fieldBadRequest('file', MATERIAL_CONTENT_MESSAGE);
    }
    return known.type;
  }
  if (known.extension === '.docx' && !startsWithAscii(header, 'PK')) {
    throw fieldBadRequest('file', MATERIAL_CONTENT_MESSAGE);
  }
  if (
    known.extension === '.doc' &&
    !header.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))
  ) {
    throw fieldBadRequest('file', MATERIAL_CONTENT_MESSAGE);
  }
  if (known.extension === '.txt' && header.includes(0)) {
    throw fieldBadRequest('file', MATERIAL_CONTENT_MESSAGE);
  }
  return known.type;
}
