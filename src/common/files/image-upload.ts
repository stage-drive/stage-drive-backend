import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage, FileFilterCallback } from 'multer';
import { join } from 'path';
import { Request } from 'express';
import { fieldBadRequest } from '../validation/field-error';

type ImageType = {
  extension: string;
  matches: (header: Buffer) => boolean;
};

function startsWithBytes(header: Buffer, bytes: number[]): boolean {
  return (
    header.length >= bytes.length &&
    bytes.every((byte, index) => header[index] === byte)
  );
}

/**
 * Дозволені формати. Розширення файлу на диску береться звідси,
 * а не з імені, яке надіслав клієнт: express.static віддає Content-Type
 * за розширенням, тож чуже розширення (.html, .svg) не має потрапити в uploads.
 */
const IMAGE_TYPES = new Map<string, ImageType>([
  [
    'image/jpeg',
    {
      extension: '.jpg',
      matches: (header) => startsWithBytes(header, [0xff, 0xd8, 0xff]),
    },
  ],
  [
    'image/png',
    {
      extension: '.png',
      matches: (header) =>
        startsWithBytes(
          header,
          [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
        ),
    },
  ],
  [
    'image/webp',
    {
      extension: '.webp',
      matches: (header) =>
        header.length >= 12 &&
        header.toString('ascii', 0, 4) === 'RIFF' &&
        header.toString('ascii', 8, 12) === 'WEBP',
    },
  ],
  [
    'image/gif',
    {
      extension: '.gif',
      matches: (header) =>
        ['GIF87a', 'GIF89a'].includes(header.toString('ascii', 0, 6)),
    },
  ],
]);

/** Скільки перших байтів файлу достатньо, щоб розпізнати будь-який формат. */
export const IMAGE_SIGNATURE_LENGTH = 12;

export const IMAGE_MAX_SIZE = 2 * 1024 * 1024;

export const IMAGE_TYPE_MESSAGE =
  'Дозволені лише зображення JPEG, PNG, WEBP і GIF.';
export const IMAGE_CONTENT_MESSAGE =
  'Вміст файлу не відповідає формату зображення. Дозволені JPEG, PNG, WEBP і GIF.';
export const IMAGE_TOO_LARGE_MESSAGE =
  'Файл завеликий. Максимальний розмір — 2 МБ.';
export const IMAGE_REQUIRED_MESSAGE = 'Додайте файл зображення.';

export function ensureUploadDir(subdir: string): string {
  const dir = join(process.cwd(), 'uploads', subdir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Чи відповідають перші байти файлу заявленому MIME-типу. */
export function matchesImageSignature(
  mimetype: string,
  header: Buffer,
): boolean {
  return IMAGE_TYPES.get(mimetype)?.matches(header) ?? false;
}

/**
 * Нове ім'я на кожне завантаження: старий файл не перезаписується,
 * тож його можна безпечно видалити після оновлення запису в базі,
 * а браузер не показує закешоване старе зображення за тим самим URL.
 */
export function imageFilename(
  ownerId: string,
  mimetype: string,
): string | undefined {
  const type = IMAGE_TYPES.get(mimetype);
  return type ? `${ownerId}-${randomUUID()}${type.extension}` : undefined;
}

export function imageFileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback,
) {
  if (!IMAGE_TYPES.has(file.mimetype)) {
    cb(fieldBadRequest(file.fieldname, IMAGE_TYPE_MESSAGE));
    return;
  }
  cb(null, true);
}

export function imageStorage(
  subdir: string,
  resolveId: (req: Request) => string | undefined = (req) => req.user?.id,
) {
  return diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, ensureUploadDir(subdir));
    },
    filename: (req, file, cb) => {
      const filename = imageFilename(
        resolveId(req) ?? 'unknown',
        file.mimetype,
      );
      if (!filename) {
        cb(fieldBadRequest(file.fieldname, IMAGE_TYPE_MESSAGE), '');
        return;
      }
      cb(null, filename);
    },
  });
}

export function publicUploadUrl(subdir: string, filename: string): string {
  return `/uploads/${subdir}/${filename}`;
}
