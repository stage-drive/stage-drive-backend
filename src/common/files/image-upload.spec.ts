import { BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import {
  IMAGE_TYPE_MESSAGE,
  imageFileFilter,
  imageFilename,
  matchesImageSignature,
} from './image-upload';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF = Buffer.from('GIF89a\x01\x00', 'binary');
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
]);
const HTML = Buffer.from('<script>alert(1)</script>');

function multerFile(mimetype: string, fieldname = 'file') {
  return {
    fieldname,
    mimetype,
    originalname: 'evil.html',
  } as Express.Multer.File;
}

describe('imageFilename', () => {
  it('takes the extension from the MIME type, not from the client filename', () => {
    expect(imageFilename('user-1', 'image/png')).toMatch(
      /^user-1-[0-9a-f-]{36}\.png$/,
    );
    expect(imageFilename('user-1', 'image/jpeg')).toMatch(/\.jpg$/);
    expect(imageFilename('user-1', 'image/webp')).toMatch(/\.webp$/);
    expect(imageFilename('user-1', 'image/gif')).toMatch(/\.gif$/);
  });

  it('gives every upload a new name so the previous file is never overwritten', () => {
    const first = imageFilename('user-1', 'image/png');
    const second = imageFilename('user-1', 'image/png');

    expect(first).not.toEqual(second);
  });

  it.each(['text/html', 'image/svg+xml', 'application/octet-stream'])(
    'returns undefined for %s',
    (mimetype) => {
      expect(imageFilename('user-1', mimetype)).toBeUndefined();
    },
  );
});

describe('imageFileFilter', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])(
    'accepts %s',
    (mimetype) => {
      const cb = jest.fn();

      imageFileFilter({} as Request, multerFile(mimetype), cb);

      expect(cb).toHaveBeenCalledWith(null, true);
    },
  );

  it.each(['text/html', 'image/svg+xml', 'application/pdf'])(
    'rejects %s with a field error for the upload field',
    (mimetype) => {
      const cb = jest.fn();

      imageFileFilter({} as Request, multerFile(mimetype, 'logo'), cb);

      const [error] = cb.mock.calls[0] as [BadRequestException];
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'logo', message: IMAGE_TYPE_MESSAGE }],
      });
    },
  );
});

describe('matchesImageSignature', () => {
  it.each([
    ['image/png', PNG],
    ['image/jpeg', JPEG],
    ['image/gif', GIF],
    ['image/webp', WEBP],
  ])('recognises real %s content', (mimetype, header) => {
    expect(matchesImageSignature(mimetype, header)).toBe(true);
  });

  it('rejects HTML declared as an image', () => {
    expect(matchesImageSignature('image/png', HTML)).toBe(false);
  });

  it('rejects content of a different image type than declared', () => {
    expect(matchesImageSignature('image/jpeg', PNG)).toBe(false);
  });

  it('rejects an empty or truncated file', () => {
    expect(matchesImageSignature('image/png', Buffer.alloc(0))).toBe(false);
    expect(matchesImageSignature('image/png', PNG.subarray(0, 4))).toBe(false);
    expect(matchesImageSignature('image/webp', WEBP.subarray(0, 8))).toBe(
      false,
    );
  });

  it('rejects a MIME type that is not allowed', () => {
    expect(matchesImageSignature('image/svg+xml', PNG)).toBe(false);
  });
});
