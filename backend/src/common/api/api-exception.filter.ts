import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { ApiError } from './api-error';

/**
 * Converts every thrown error into `{ success: false, error: { code, message, details? } }`.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toResponse(exception);
    if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    res.status(status).json(body);
  }

  private toResponse(exception: unknown): { status: number; body: unknown } {
    if (exception instanceof ApiError) {
      return {
        status: exception.status,
        body: {
          success: false,
          error: { code: exception.code, message: exception.message, details: exception.details ?? null },
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse() as string | { message?: string | string[]; error?: string };
      const message =
        typeof response === 'string'
          ? response
          : Array.isArray(response.message)
            ? 'Validation failed'
            : response.message ?? exception.message;
      const details =
        typeof response !== 'string' && Array.isArray(response.message) ? { issues: response.message } : null;
      return {
        status,
        body: {
          success: false,
          error: { code: status === 400 ? 'VALIDATION_ERROR' : httpCode(status), message, details },
        },
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return {
          status: HttpStatus.CONFLICT,
          body: {
            success: false,
            error: {
              code: 'UNIQUE_CONSTRAINT',
              message: `A record with the same unique value already exists (${String(exception.meta?.target ?? 'field')})`,
              details: null,
            },
          },
        };
      }
      if (exception.code === 'P2025') {
        return {
          status: HttpStatus.NOT_FOUND,
          body: { success: false, error: { code: 'NOT_FOUND', message: 'Record not found', details: null } },
        };
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', details: null },
      },
    };
  }
}

function httpCode(status: number): string {
  switch (status) {
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 405:
      return 'METHOD_NOT_ALLOWED';
    case 409:
      return 'CONFLICT';
    default:
      return `HTTP_${status}`;
  }
}
