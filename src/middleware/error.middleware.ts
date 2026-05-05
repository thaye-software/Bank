import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../shared/errors';
import { logger } from '../config/logger';

export function errorMiddleware(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof AppError) {
    if (error.httpStatus >= 500) {
      logger.error({ error, code: error.code }, error.message);
    } else {
      logger.warn({ code: error.code }, error.message);
    }

    res.status(error.httpStatus).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    });
    return;
  }

  logger.error({ error }, 'Unhandled error');
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}
