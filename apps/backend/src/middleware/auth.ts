import type { RequestHandler } from 'express';
import { verifyAccessToken } from '../utils/jwt.js';
import { ApiError } from '../utils/apiError.js';
import type { Role } from '../types/index.js';

/**
 * Authentication: requires a valid Bearer access token. Populates `req.principal`.
 * Rejects with 401 on missing/invalid/expired tokens.
 */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(ApiError.unauthorized('Missing access token'));
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    req.principal = verifyAccessToken(token);
    next();
  } catch {
    next(ApiError.unauthorized('Invalid or expired access token'));
  }
};

/**
 * Authorization: requires the authenticated principal to hold one of the allowed roles.
 * Must run after `authenticate`. Every protected route mounts this with explicit roles.
 */
export function authorize(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.principal) return next(ApiError.unauthorized());
    if (!roles.includes(req.principal.role)) {
      return next(ApiError.forbidden('Insufficient role for this resource'));
    }
    next();
  };
}
