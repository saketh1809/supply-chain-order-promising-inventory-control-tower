import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map, tap } from 'rxjs';
import { Request, Response } from 'express';

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Marker returned by services for list endpoints; unwrapped by ResponseEnvelopeInterceptor. */
export class Paginated<T> {
  readonly __paginated = true;
  constructor(
    public readonly items: T[],
    public readonly meta: PaginationMeta,
  ) {}
}

export function paginate<T>(items: T[], page: number, pageSize: number, total: number): Paginated<T> {
  return new Paginated(items, {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

/**
 * Wraps every successful response in `{ success: true, data, meta? }`.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((body) => {
        if (body instanceof Paginated) {
          return { success: true, data: body.items, meta: body.meta };
        }
        return { success: true, data: body === undefined ? null : body };
      }),
    );
  }
}

/** Logs method, path, status and latency for each request. */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const started = Date.now();
    return next.handle().pipe(
      tap({
        next: () => this.log(req, res, started),
        error: () => this.log(req, res, started),
      }),
    );
  }

  private log(req: Request, res: Response, started: number) {
    const ms = Date.now() - started;
    this.logger.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
  }
}
