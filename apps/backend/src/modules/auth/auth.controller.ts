import type { CookieOptions, Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/apiError.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { AuditAction } from '../../constants/enums.js';
import { recordAudit } from '../audit/audit.service.js';
import type { IssuedRefreshToken } from '../../utils/jwt.js';
import { Roles, type Role } from '../../types/index.js';
import type { ChangePasswordInput, LoginInput, RefreshInput } from './auth.schema.js';
import { changePassword, getMe, login, logout, rotateRefresh } from './auth.service.js';

// Cookies are keyed by (name, domain, path) — NOT by port and NOT by the origin that set them.
// All three SPAs talk to the same API host, so a single `refresh_token` cookie would be one
// shared slot: logging into the user app would overwrite the admin's cookie, and reloading
// admin would then rotate the USER token, fail its role check and log it out (and vice versa).
// Giving each app its own cookie name keeps the three sessions independent.
const REFRESH_COOKIE_PREFIX = 'refresh_token';
/** Legacy shared cookie, still honoured when a client doesn't declare its audience. */
const LEGACY_REFRESH_COOKIE = REFRESH_COOKIE_PREFIX;

/** Every per-app cookie name, for the un-declared-audience fallback in `refreshController`. */
const SCOPED_COOKIE_NAMES = ['admin', 'user', 'scanner'].map(
  (aud) => `${REFRESH_COOKIE_PREFIX}_${aud}`,
);

/** The app a role belongs to. ADMIN and SUPER_ADMIN share the admin portal, so one cookie. */
function audienceOf(role: Role): 'admin' | 'user' | 'scanner' {
  if (role === Roles.USER) return 'user';
  if (role === Roles.SCANNER) return 'scanner';
  return 'admin';
}

function refreshCookieName(role: Role): string {
  return `${REFRESH_COOKIE_PREFIX}_${audienceOf(role)}`;
}

// A Domain of "localhost" (or empty) is omitted entirely and the cookie is left host-only.
// Browsers frequently REJECT a Set-Cookie with `Domain=localhost` (it never gets stored, so
// it's never sent back on reload → the app logs out on every refresh). Host-only cookies work
// everywhere; a real registrable domain (e.g. ".example.com") is passed through untouched.
const cookieDomain =
  env.COOKIE_DOMAIN && env.COOKIE_DOMAIN.toLowerCase() !== 'localhost'
    ? env.COOKIE_DOMAIN
    : undefined;

/** Everything that identifies the cookie. A delete must match these exactly or it misses. */
function baseCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    domain: cookieDomain,
    path: '/api/v1/auth',
  };
}

function refreshCookieOptions(expiresAt: Date): CookieOptions {
  return { ...baseCookieOptions(), expires: expiresAt };
}

/**
 * Approximate registrable domain (last two labels). Good enough to tell `app.example.com` and
 * `api.example.com` apart from `xyz.vercel.app` and `abc.onrender.com`; a multi-part public
 * suffix like `.co.uk` would need the real Public Suffix List, but erring toward "same site"
 * there only costs us a missed warning, never a false alarm.
 */
function siteOf(host: string): string {
  const name = host.split(':')[0]!.toLowerCase();
  const labels = name.split('.');
  return labels.length <= 2 ? name : labels.slice(-2).join('.');
}

let warnedCrossSite = false;

/**
 * A `SameSite=Strict`/`Lax` cookie is never sent back on a cross-site request, so if the app
 * calling us lives on a different site than this API, the session dies on the next reload —
 * login succeeds, the cookie is stored, and the browser then refuses to send it. That looks
 * exactly like "the app logs me out when I refresh", with nothing in the logs to explain it.
 *
 * We can detect it precisely, because the request carries both sides: the caller's `Origin`
 * and our own `Host`. Warn once per process rather than per login.
 */
function warnIfCookieWillNotComeBack(req: Request): void {
  if (warnedCrossSite || env.COOKIE_SAMESITE === 'none') return;
  const origin = req.get('origin');
  const host = req.get('host');
  if (!origin || !host) return;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return;
  }
  if (siteOf(originHost) === siteOf(host)) return;

  warnedCrossSite = true;
  logger.warn(
    { origin, apiHost: host, sameSite: env.COOKIE_SAMESITE, secure: env.COOKIE_SECURE },
    '[auth] cross-site frontend with SameSite=' +
      env.COOKIE_SAMESITE +
      ': the browser will NOT send the refresh cookie back, so every reload will log the user ' +
      'out. Set COOKIE_SAMESITE=none and COOKIE_SECURE=true (both required together).',
  );
}

function setRefreshCookie(res: Response, role: Role, refresh: IssuedRefreshToken): void {
  res.cookie(refreshCookieName(role), refresh.raw, refreshCookieOptions(refresh.expiresAt));
}

function clearCookieNamed(res: Response, name: string): void {
  // No `expires` key at all: Express supplies a past date itself. The previous code passed
  // `expires: undefined`, and because Express merges the caller's options *over* its default
  // via utils-merge, an own property holding `undefined` still wins — dropping the attribute
  // and turning the delete into an empty **session** cookie that lingers for the whole
  // browser session instead of disappearing.
  res.clearCookie(name, baseCookieOptions());
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
  setRefreshCookie(res, result.user.role, result.refresh);
  warnIfCookieWillNotComeBack(req);
  // Drop any cookie left over from the single shared-slot scheme so it can't shadow the
  // per-app one on the next refresh.
  clearCookieNamed(res, LEGACY_REFRESH_COOKIE);
  await recordAudit({
    action: AuditAction.LOGIN,
    user: result.user.id,
    role: result.user.role,
    req,
    metadata: { role: result.user.role },
  });
  res.json({ accessToken: result.accessToken, user: result.user });
});

/**
 * Refuse a refresh driven from a page we don't serve.
 *
 * `/auth/refresh` authenticates purely by cookie and accepts a bodyless POST, and in cross-site
 * production the cookie is `SameSite=None` — so any page could fire a credentialed request at
 * it. CORS stops the attacker *reading* the new token, so this was never account takeover, but
 * the call still rotated the victim's token; repeated, it trips reuse-detection and forces a
 * logout. Checking `Origin` against the CORS whitelist costs nothing and closes it now, without
 * waiting on the `SameSite=lax` change that same-origin proxying will eventually allow.
 *
 * A missing `Origin` is allowed through: non-browser callers (curl, health checks, the mobile
 * shell) send none, and they are not the threat — the attack needs a browser to attach the
 * cookie, and browsers always set `Origin` on a cross-origin POST.
 */
function assertTrustedOrigin(req: Request): void {
  const origin = req.get('origin');
  if (!origin) return;
  if (env.CORS_ORIGINS.includes(origin)) return;
  throw ApiError.forbidden('Origin not allowed');
}

export const refreshController = asyncHandler(async (req: Request, res: Response) => {
  assertTrustedOrigin(req);
  const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
  const { role: audienceRole } = (req.body ?? {}) as RefreshInput;

  // Prefer the calling app's own cookie; fall back to the legacy shared one so sessions
  // created before per-app cookies existed survive exactly one more refresh.
  const scopedName = audienceRole ? refreshCookieName(audienceRole) : undefined;
  let raw = (scopedName ? cookies[scopedName] : undefined) ?? cookies[LEGACY_REFRESH_COOKIE];

  // A client that doesn't declare its audience is a frontend build from before per-app cookies
  // existed. It can only ever ask for the legacy cookie — which no current login issues — so it
  // 401s on every single reload and logs itself out, while a redeployed sibling app on the same
  // browser works fine. Deploys drift, so don't let that be fatal: when the jar holds exactly
  // one per-app cookie there is nothing to disambiguate, and it is unambiguously this caller's.
  if (!raw && !audienceRole) {
    const present = SCOPED_COOKIE_NAMES.filter((name) => cookies[name]);
    if (present.length === 1) raw = cookies[present[0]!];
  }
  if (!raw) throw ApiError.unauthorized('Missing refresh token');

  // Rotating a token that belongs to a DIFFERENT app must fail outright. Without this the
  // legacy fallback could hand the user app an admin session, which the client then discards
  // by logging itself out — the exact symptom per-app cookies exist to remove.
  const result = await rotateRefresh(raw, req, audienceRole);

  setRefreshCookie(res, result.user.role, result.refresh);
  if (!scopedName || !cookies[scopedName]) clearCookieNamed(res, LEGACY_REFRESH_COOKIE);
  res.json({ accessToken: result.accessToken, user: result.user });
});

export const logoutController = asyncHandler(async (req: Request, res: Response) => {
  // Same reasoning as refresh: a cross-site page must not be able to end someone's session.
  assertTrustedOrigin(req);
  const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
  // The access token may already have expired, so fall back to the audience the app declares.
  const role = req.principal?.role ?? (req.body as RefreshInput | undefined)?.role;
  const scopedName = role ? refreshCookieName(role) : undefined;
  const raw = (scopedName ? cookies[scopedName] : undefined) ?? cookies[LEGACY_REFRESH_COOKIE];
  await logout(raw);
  if (scopedName) clearCookieNamed(res, scopedName);
  clearCookieNamed(res, LEGACY_REFRESH_COOKIE);
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
  await recordAudit({ action: AuditAction.PASSWORD_CHANGE, req });
  res.json({ success: true });
});
