import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';
import { ZodError } from 'zod';
import { ValidationError } from '../shared/errors';

interface RequestSchemas {
  body?: ZodSchema<unknown>;
  params?: ZodSchema<unknown>;
  query?: ZodSchema<unknown>;
}

export function validate(schemas: RequestSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as Record<string, string>;
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query) as Record<string, string>;
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ValidationError('Request validation failed', error.flatten().fieldErrors));
      } else {
        next(error);
      }
    }
  };
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
