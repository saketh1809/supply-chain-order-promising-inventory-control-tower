import { HttpStatus } from '@nestjs/common';

/**
 * Domain error with a stable machine-readable code. Services throw these; the global
 * exception filter converts them into the standard error envelope.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(code: string, message: string, details?: Record<string, unknown>) {
    return new ApiError(HttpStatus.BAD_REQUEST, code, message, details);
  }

  static notFound(entity: string, id: string | number) {
    return new ApiError(HttpStatus.NOT_FOUND, `${toCode(entity)}_NOT_FOUND`, `${entity} ${id} was not found`);
  }

  static conflict(code: string, message: string, details?: Record<string, unknown>) {
    return new ApiError(HttpStatus.CONFLICT, code, message, details);
  }

  static unprocessable(code: string, message: string, details?: Record<string, unknown>) {
    return new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, code, message, details);
  }

  static unauthorized(message = 'Unknown or missing user. Send a valid x-user-id header.') {
    return new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', message);
  }
}

function toCode(entity: string): string {
  return entity.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').toUpperCase();
}
