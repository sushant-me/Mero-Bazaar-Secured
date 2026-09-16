import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { json, urlencoded } from 'express';

async function bootstrap() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error(
      'JWT_SECRET is missing or too short (need 32+ chars of entropy). Refusing to start.',
    );
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.setGlobalPrefix('api');
  app.use(json({ limit: '15mb' }));
  app.use(urlencoded({ limit: '15mb', extended: true }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads',
  });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`NestJS running on http://localhost:${port}`);
}
bootstrap();
