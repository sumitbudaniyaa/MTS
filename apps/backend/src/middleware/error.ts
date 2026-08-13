import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { ApiError } from '../utils/apiError.js';
import { logger } from '../config/logger.js';
import { isProd } from '../config/env.js';

/** 404 fallthrough for unmatched routes. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
};

/**
 * Central error translator. Normalizes Zod, Mongoose and duplicate-key errors into the
 * stable `{ error: { code, message, details } }` envelope. Unknown errors are logged and
 * returned as a generic 500 — internals are never leaked in production.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let apiError: ApiError;

  if (err instanceof ApiError || (err && typeof err === 'object' && 'isOperational' in err && err.isOperational)) {
    apiError = err as ApiError;
  } else if (err instanceof ZodError) {
    apiError = ApiError.badRequest('Validation failed', err.issues);
  } else if (err instanceof mongoose.Error.ValidationError) {
    apiError = ApiError.badRequest('Validation failed', err.errors);
  } else if (isDuplicateKeyError(err)) {
    apiError = ApiError.conflict('Resource already exists', err.keyValue);
  } else if (err instanceof mongoose.Error.CastError) {
    apiError = ApiError.badRequest(`Invalid value for ${err.path}`);
  } else {
    logger.error({ err, path: req.originalUrl }, 'Unhandled error');
    apiError = ApiError.internal();
  }

  if (apiError.statusCode >= 500) {
    logger.error({ err, path: req.originalUrl }, apiError.message);
  }

  res.status(apiError.statusCode).json({
    error: {
      code: apiError.code,
      message: apiError.message,
      details: apiError.details,
      ...(isProd ? {} : { stack: apiError.stack }),
    },
  });
};

interface DuplicateKeyError {
  code: number;
  keyValue?: Record<string, unknown>;
}

function isDuplicateKeyError(err: unknown): err is DuplicateKeyError {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}
