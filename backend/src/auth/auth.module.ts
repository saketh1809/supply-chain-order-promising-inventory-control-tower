import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppConfig } from '../common/config/configuration';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthThrottlerGuard } from './auth-throttler.guard';
import { HealthController } from './health.controller';

@Module({
  imports: [
    // Secrets and lifetimes are passed per call in AuthService (access and refresh use different secrets).
    JwtModule.register({}),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const { limit, ttlMs } = config.get('authRateLimit', { infer: true });
        return [{ ttl: ttlMs, limit }];
      },
    }),
  ],
  controllers: [AuthController, HealthController],
  providers: [AuthService, AuthThrottlerGuard, { provide: APP_GUARD, useClass: JwtAuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}
