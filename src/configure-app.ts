import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { ensureUploadDir } from './common/files/image-upload';
import { configureSwagger } from './configure-swagger';

export function configureApp(app: NestExpressApplication) {
  ensureUploadDir('avatars');
  ensureUploadDir('logos');
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' });
  app.setGlobalPrefix('api', { exclude: ['/'] });
  configureSwagger(app);
}
