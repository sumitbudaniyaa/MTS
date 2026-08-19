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
 * Refuses the API to an account whose borrowed password has run out of time.
 *
 * A password someone else chose — the shared default at creation, or an admin reset — carries a
 * deadline (`PASSWORD_GRACE_DAYS`). Inside the window the account works normally and the apps
 * nudge; past it, this blocks everything. Mount it after `authenticate` on the protected
 * routers, never on `/auth`, or the holder could not read themselves or set a new password and
 * would be permanently stuck.
 *
 * Read from the token rather than the database so it costs nothing per request. The deadline is
 * carried as a timestamp instead of a pre-computed boolean, so a window that lapses part-way
 * through a token's life is noticed on the very next request.
 */
export const requireCurrentPassword: RequestHandler = (req, _res, next) => {
  const p = req.principal;
  if (!p?.mustChangePassword || !p.passwordExpiresAt) return next();
  if (Date.now() <= p.passwordExpiresAt) return next(); // still inside the grace window
  next(
    ApiError.forbidden(
      'Your temporary password has expired. Set a new password to continue.',
      { code: 'PASSWORD_EXPIRED', expiredAt: new Date(p.passwordExpiresAt).toISOString() },
    ),
  );
};

/**
 * Best-effort authentication: populates `req.principal` when a valid token is present and
 * continues regardless. For endpoints that are authorized by something other than the access
 * token — logout, which is authorized by possession of the refresh cookie — and which must
 * still work once the short-lived access token has expired.
 */
export const authenticateOptional: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      req.principal = verifyAccessToken(header.slice('Bearer '.length).trim());
    } catch {
      // An expired or bad token is not an error here — the caller is identified by its cookie.
    }
  }
  next();
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
