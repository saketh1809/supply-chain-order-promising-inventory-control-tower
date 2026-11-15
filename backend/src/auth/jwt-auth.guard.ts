import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { Request } from 'express';
import { ApiError } from '../common/api/api-error';
import { AppConfig } from '../common/config/configuration';
import { IS_PUBLIC_KEY } from './public.decorator';

export interface AccessTokenPayload {
  sub: number;
  role: 'PLANNER' | 'SUPPORT' | 'ADMIN';
  typ: 'access';
}

export type AuthedRequest = Request & { actorId?: number; user?: { id: number; role: AccessTokenPayload['role'] } };

/**
 * Global guard: every route needs `Authorization: Bearer <access token>` unless it is marked @Public().
 * The token is verified with the access secret only (the refresh secret is different, so a refresh
 * token can never be used as an access token). On success the user id is placed on the request,
 * where the existing `@Actor()` decorator picks it up for audit records.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
    if (!match) throw ApiError.unauthorized('Sign in to continue.', 'TOKEN_MISSING');

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(match[1], {
        secret: this.config.get('jwt', { infer: true }).accessSecret,
        algorithms: ['HS256'],
      });
      if (payload.typ !== 'access' || !Number.isInteger(payload.sub)) throw new Error('wrong token type');
      req.actorId = payload.sub;
      req.user = { id: payload.sub, role: payload.role };
      return true;
    } catch (err) {
      if (err instanceof TokenExpiredError) throw ApiError.unauthorized('Your session expired.', 'TOKEN_EXPIRED');
      throw ApiError.unauthorized('Invalid access token.', 'TOKEN_INVALID');
    }
  }
}
