import type { CookieOptions, Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/apiError.js';
import { env } from '../../config/env.js';
import { AuditAction } from '../../constants/enums.js';
import { recordAudit } from '../audit/audit.service.js';
import type { IssuedRefreshToken } from '../../utils/jwt.js';
import type { ChangePasswordInput, LoginInput } from './auth.schema.js';
import { changePassword, getMe, login, logout, rotateRefresh } from './auth.service.js';

const REFRESH_COOKIE = 'refresh_token';

// A Domain of "localhost" (or empty) is omitted entirely and the cookie is left host-only.
// Browsers frequently REJECT a Set-Cookie with `Domain=localhost` (it never gets stored, so
// it's never sent back on reload → the app logs out on every refresh). Host-only cookies work
// everywhere; a real registrable domain (e.g. ".example.com") is passed through untouched.
const cookieDomain =
  env.COOKIE_DOMAIN && env.COOKIE_DOMAIN.toLowerCase() !== 'localhost'
    ? env.COOKIE_DOMAIN
    : undefined;

function refreshCookieOptions(expiresAt: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    domain: cookieDomain,
    path: '/api/v1/auth',
    expires: expiresAt,
  };
}

function setRefreshCookie(res: Response, refresh: IssuedRefreshToken): void {
  res.cookie(REFRESH_COOKIE, refresh.raw, refreshCookieOptions(refresh.expiresAt));
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(new Date()), expires: undefined });
}

export const loginController = asyncHandler(async (req: Request, res: Response) => {
  const { mobile, password, role } = req.body as LoginInput;
  let result;
  try {
    result = await login(mobile, password, req, role);
  } catch (err) {
    // Record the failed attempt (never the password) for brute-force visibility, then rethrow.
    await recordAudit({
      action: AuditAction.LOGIN_FAILED,
      req,
      success: false,
      metadata: { mobile, audience: role ?? null },
    });
    throw err;
  }
  setRefreshCookie(res, result.refresh);
  await recordAudit({
    action: AuditAction.LOGIN,
    user: result.user.id,
    role: result.user.role,
    req,
    metadata: { role: result.user.role },
  });
  res.json({ accessToken: result.accessToken, user: result.user });
});

export const refreshController = asyncHandler(async (req: Request, res: Response) => {
  const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!raw) throw ApiError.unauthorized('Missing refresh token');
  const result = await rotateRefresh(raw, req);
  setRefreshCookie(res, result.refresh);
  res.json({ accessToken: result.accessToken, user: result.user });
});

export const logoutController = asyncHandler(async (req: Request, res: Response) => {
  const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  await logout(raw);
  clearRefreshCookie(res);
  await recordAudit({ action: AuditAction.LOGOUT, user: req.principal?.sub, req });
  res.json({ success: true });
});

export const meController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.principal) throw ApiError.unauthorized();
  const user = await getMe(req.principal.sub, req.principal.role);
  res.json({ user });
});

export const changePasswordController = asyncHandler(async (req: Request, res: Response) => {
  if (!req.principal) throw ApiError.unauthorized();
  const { currentPassword, newPassword } = req.body as ChangePasswordInput;
  await changePassword(req.principal.sub, req.principal.role, currentPassword, newPassword);
  res.json({ success: true });
});
