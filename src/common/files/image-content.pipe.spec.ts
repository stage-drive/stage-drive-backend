import { BadRequestException } from '@nestjs/common';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ImageContentPipe } from './image-content.pipe';
import { IMAGE_CONTENT_MESSAGE } from './image-upload';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

describe('ImageContentPipe', () => {
  const pipe = new ImageContentPipe();
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'image-content-pipe-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function upload(
    content: Buffer,
    mimetype: string,
  ): Promise<Express.Multer.File> {
    const path = join(dir, 'upload');
    await writeFile(path, content);
    return { fieldname: 'file', mimetype, path } as Express.Multer.File;
  }

  it('passes a file whose content matches the declared type', async () => {
    const file = await upload(PNG, 'image/png');

    await expect(pipe.transform(file)).resolves.toBe(file);
  });

  it('passes through when no file was sent', async () => {
    await expect(pipe.transform(undefined)).resolves.toBeUndefined();
  });

  it('rejects HTML sent with an image MIME type', async () => {
    const file = await upload(
      Buffer.from('<html><script>alert(1)</script></html>'),
      'image/png',
    );

    const error = await pipe.transform(file).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toEqual({
      statusCode: 400,
      errors: [{ field: 'file', message: IMAGE_CONTENT_MESSAGE }],
    });
  });

  it('rejects an image whose content is a different type than declared', async () => {
    const file = await upload(PNG, 'image/jpeg');

    await expect(pipe.transform(file)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects an empty file', async () => {
    const file = await upload(Buffer.alloc(0), 'image/png');

    await expect(pipe.transform(file)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
