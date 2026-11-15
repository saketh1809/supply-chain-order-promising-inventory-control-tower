import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';
import { ApiError } from '../api/api-error';

/**
 * Injects the id of the signed-in user. It is set by JwtAuthGuard (src/auth/jwt-auth.guard.ts)
 * from the verified access token, so it cannot be forged by the client. Every audit record uses it.
 */
export const Actor = createParamDecorator((_data: unknown, context: ExecutionContext): number => {
  const req = context.switchToHttp().getRequest<Request & { actorId?: number }>();
  if (!req.actorId) throw ApiError.unauthorized();
  return req.actorId;
});
