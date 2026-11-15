import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from './common/config/configuration';

/** Global HTTP configuration shared by the server entry point and the integration tests. */
export function configureApp(app: INestApplication, opts: { swagger?: boolean } = {}) {
  const config = app.get(ConfigService<AppConfig, true>);
  // Trust the reverse proxy (Render) so req.ip is the real client address (used by the login rate limit).
  app.getHttpAdapter().getInstance().set('trust proxy', config.get('trustProxy', { infer: true }));
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1', prefix: 'v' });
  app.enableCors({ origin: config.get('corsOrigin', { infer: true }), credentials: false });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }),
  );
  if (opts.swagger !== false) {
    const swagger = new DocumentBuilder()
      .setTitle('Supply Chain Control Tower API')
      .setDescription('Order promising, ATP, allocation, receipts, exceptions, planner actions, AI assistant and audit. Sign in with POST /auth/login, then click Authorize and paste the accessToken.')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger), { jsonDocumentUrl: 'api/docs-json' });
  }
  return app;
}
