import type { RequestHandler } from 'express';
import { ZodError, type ZodTypeAny, type infer as ZodInfer } from 'zod';
import { ApiError } from '../utils/apiError.js';

interface RequestSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Validates and replaces `req.body`/`req.query`/`req.params` with the parsed, typed and
 * stripped output. Unknown keys are dropped, types are coerced per-schema. Any validation
 * failure short-circuits with a 400 + structured issues — client input is never trusted.
 */
export function validate(schemas: RequestSchemas): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) Object.assign(req.query, schemas.query.parse(req.query));
      if (schemas.params) Object.assign(req.params, schemas.params.parse(req.params));
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(ApiError.badRequest('Validation failed', err.issues));
      } else {
        next(err);
      }
    }
  };
}

export type Infer<T extends ZodTypeAny> = ZodInfer<T>;
