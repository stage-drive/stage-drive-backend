import { BadRequestException } from '@nestjs/common';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage, FileFilterCallback } from 'multer';
import { extname, join } from 'path';
import { Request } from 'express';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export const IMAGE_MAX_SIZE = 2 * 1024 * 1024;

export function ensureUploadDir(subdir: string): string {
  const dir = join(process.cwd(), 'uploads', subdir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function imageFileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback,
) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    throw new BadRequestException(
      'Only JPEG, PNG, WEBP and GIF images are allowed',
    );
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
      const id = resolveId(req) ?? 'unknown';
      cb(null, `${id}${extname(file.originalname).toLowerCase() || '.jpg'}`);
    },
  });
}

export function publicUploadUrl(subdir: string, filename: string): string {
  return `/uploads/${subdir}/${filename}`;
}
