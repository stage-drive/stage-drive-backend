import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { ensureUploadDir } from './common/files/image-upload';
import { validationExceptionFactory } from './common/validation/field-error';
import { configureSwagger } from './configure-swagger';

export function configureApp(app: NestExpressApplication) {
  ensureUploadDir('avatars');
  ensureUploadDir('logos');
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' });
  app.setGlobalPrefix('api', { exclude: ['/'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  configureSwagger(app);
}
