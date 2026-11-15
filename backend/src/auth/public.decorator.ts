import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marks a route as reachable without an access token (login, refresh, health check). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
