import { CanActivate, ExecutionContext, Injectable, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../api/api-error';

export const DEFAULT_ACTOR_ID = 1;

/**
 * Demo identity: the acting user is taken from the `x-user-id` header (defaults to the seeded
 * planner). This is NOT authentication; see README "Security" for the production auth plan.
 * The guard verifies that the user exists and attaches it as `req.actorId`.
 */
@Injectable()
export class ActorGuard implements CanActivate {
  private readonly known = new Set<number>();

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { actorId?: number }>();
    const header = req.header('x-user-id');
    const id = header === undefined ? DEFAULT_ACTOR_ID : Number(header);
    if (!Number.isInteger(id) || id <= 0) {
      throw ApiError.unauthorized();
    }
    if (!this.known.has(id)) {
      const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
      if (!user) throw ApiError.unauthorized();
      this.known.add(id);
    }
    req.actorId = id;
    return true;
  }
}

/** Injects the acting user id resolved by ActorGuard. */
export const Actor = createParamDecorator((_data: unknown, context: ExecutionContext): number => {
  const req = context.switchToHttp().getRequest<Request & { actorId?: number }>();
  return req.actorId ?? DEFAULT_ACTOR_ID;
});
