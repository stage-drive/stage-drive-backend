import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configureSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Stage Drive API')
    .setDescription('Бекенд платформи управління автошколами')
    .setVersion('0.0.1')
    .addTag('auth')
    .addTag('users', 'Профіль поточного користувача та учасники автошколи')
    .addTag('invitations', 'Запрошення та активація акаунта')
    .addTag('dashboard', 'Дані Owner і Admin Dashboard')
    .addTag('students', 'Студенти автошколи')
    .addTag('cars', 'Автомобілі автошколи')
    .addTag(
      'courses',
      'Теоретичні курси: програма, розділи, уроки та матеріали',
    )
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
}
