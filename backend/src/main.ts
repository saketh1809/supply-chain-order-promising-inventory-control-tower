import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AppConfig } from './common/config/configuration';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);
  const port = app.get(ConfigService<AppConfig, true>).get('port', { infer: true });
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}/api/v1 (docs: /api/docs)`, 'Bootstrap');
}

bootstrap();
