import type { Request } from 'express';
import { RefreshTokenModel } from '../../models/index.js';
import { verifyPassword } from '../../utils/password.js';
import {
  familyOf,
  hashRefreshToken,
  issueRefreshToken,
  signAccessToken,
  type IssuedRefreshToken,
} from '../../utils/jwt.js';
import { ApiError } from '../../utils/apiError.js';
import type { AuthPrincipal, Role } from '../../types/index.js';
import { hashPassword } from '../../utils/password.js';
import { recordAudit } from '../audit/audit.service.js';
import { AuditAction } from '../../constants/enums.js';
import {
  findAccountById,
  findAccountByMobile,
  getPasswordHashById,
  setPasswordById,
  type Account,
} from './account.service.js';

export interface AuthTokens {
  accessToken: string;
  refresh: IssuedRefreshToken;
  user: PublicUser;
}

export interface PublicUser {
  id: string;
  mobile: string;
  name: string;
  role: Role;
  unit: string | null;
  /** Clients use this to nudge, and to force the change once the deadline passes. */
  mustChangePassword: boolean;
  /** ISO deadline for changing it, or null when the owner chose it themselves. */
  passwordExpiresAt: string | null;
}

function toPublicUser(account: Account): PublicUser {
  return {
    id: account.id,
    mobile: account.mobile,
    name: account.name,
    role: account.role,
    unit: account.unit,
    mustChangePassword: account.mustChangePassword,
    passwordExpiresAt: account.passwordExpiresAt ? account.passwordExpiresAt.toISOString() : null,
  };
}

function principalOf(account: Account): AuthPrincipal {
  return {
    sub: account.id,
    role: account.role,
    unit: account.unit ?? undefined,
    mustChangePassword: account.mustChangePassword,
    passwordExpiresAt: account.passwordExpiresAt?.getTime(),
  };
}

async function persistRefresh(
  account: Account,
  refresh: IssuedRefreshToken,
  req?: Request,
): Promise<void> {
  await RefreshTokenModel.create({
    user: account.id,
    role: account.role,
    tokenHash: refresh.hash,
    family: refresh.family,
    expiresAt: refresh.expiresAt,
    createdByIp: req?.ip ?? null,
    userAgent: req?.headers['user-agent'] ?? null,
  });
}

/** Authenticate by mobile + password (scoped to the app's role when given) and issue tokens. */
export async function login(
  mobile: string,
  password: string,
  req?: Request,
  role?: Role,
): Promise<AuthTokens> {
  const account = await findAccountByMobile(mobile, role);

  if (account?.lockedUntil && account.lockedUntil.getTime() > Date.now()) {
    const remainingMins = Math.max(
      1,
      Math.ceil((account.lockedUntil.getTime() - Date.now()) / 60_000),
    );
    throw ApiError.forbidden(
      `Account is locked due to repeated failed login attempts. Try again in ${remainingMins} minute(s) or contact a Super Admin.`,
    );
  }

  // Always run a verify to keep timing roughly constant whether or not the account exists.
  const hash = account?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinv';
  const ok = await verifyPassword(password, hash);

  if (!account || !ok) {
    if (account) {
      const { failedCount, lockedUntil } = await account.recordFailedLogin();
      await recordAudit({
        action: AuditAction.LOGIN_FAILED,
        req,
        metadata: { mobile, role, failedCount, locked: Boolean(lockedUntil) },
      });

      if (lockedUntil) {
        const remainingMins = Math.max(
          1,
          Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000),
        );
        throw ApiError.forbidden(
          `Account locked after 5 failed attempts. Try again in ${remainingMins} minute(s) or contact a Super Admin.`,
        );
      }
    }
    throw ApiError.unauthorized('Invalid credentials');
  }

  if (!account.active) throw ApiError.forbidden('Account is disabled');

  await account.touchLogin();

  const accessToken = signAccessToken(principalOf(account));
  const refresh = issueRefreshToken();
  await persistRefresh(account, refresh, req);

  return { accessToken, refresh, user: toPublicUser(account) };
}

// A token that was already rotated is accepted only within this window after its rotation, to
// tolerate the reload/concurrent-tab race. Presenting it LATER than this is treated as reuse of
// a leaked token → the whole family is revoked (theft response).
const REUSE_GRACE_MS = 30_000;

/**
 * Whether a token's account role is servable to the app that presented it. The admin portal
 * signs in as `ADMIN` but the account itself may be `ADMIN` or `SUPER_ADMIN`.
 */
function belongsToAudience(tokenRole: Role, audience: Role): boolean {
  if (audience === 'ADMIN') return tokenRole === 'ADMIN' || tokenRole === 'SUPER_ADMIN';
  return tokenRole === audience;
}

/**
 * Rotate a refresh token. Resilient to the rotation race (concurrent tabs / a reload firing
 * two refreshes): a token that was already rotated (revoked WITH a successor) is still accepted
 * for a short grace window, minting a fresh token in the same family. Rejected when:
 *  - unknown / expired,
 *  - revoked WITHOUT a successor (i.e. logged out),
 *  - revoked WITH a successor but presented long after rotation → treated as **token reuse**,
 *    which revokes the entire family (a stolen, already-rotated token can't be replayed),
 *  - held by an account outside `audience` — the app that presented the token doesn't own it.
 */
export async function rotateRefresh(
  rawToken: string,
  req?: Request,
  audience?: Role,
): Promise<AuthTokens> {
  const tokenHash = hashRefreshToken(rawToken);
  const existing = await RefreshTokenModel.findOne({ tokenHash });

  if (!existing) throw ApiError.unauthorized('Invalid refresh token');
  if (existing.expiresAt.getTime() <= Date.now()) {
    throw ApiError.unauthorized('Refresh token expired');
  }
  if (existing.revokedAt) {
    // Revoked by logout (no successor) — genuinely dead.
    if (!existing.replacedBy) throw ApiError.unauthorized('Refresh token already used');
    // Rotated already: benign only within the grace window; otherwise it's a replayed/leaked
    // token — kill the whole family so neither the attacker nor the victim can keep using it.
    if (Date.now() - existing.revokedAt.getTime() > REUSE_GRACE_MS) {
      await RefreshTokenModel.updateMany(
        { family: existing.family, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
      throw ApiError.unauthorized('Refresh token reuse detected');
    }
  }

  if (audience && !belongsToAudience(existing.role as Role, audience)) {
    throw ApiError.unauthorized('Refresh token belongs to another app');
  }

  const account = await findAccountById(String(existing.user), existing.role as Role);
  if (!account || !account.active) throw ApiError.unauthorized('Account unavailable');

  // Rotate: mint a successor in the same family. If the presented token wasn't already
  // rotated, revoke it now (normal path); if it was (benign race), leave it as-is.
  const next = issueRefreshToken(existing.family);
  if (!existing.revokedAt) {
    existing.revokedAt = new Date();
    existing.replacedBy = next.hash;
    await existing.save();
  }
  await persistRefresh(account, next, req);

  const accessToken = signAccessToken(principalOf(account));
  return { accessToken, refresh: next, user: toPublicUser(account) };
}

/** Revoke the presented refresh token and its whole family (logout). */
export async function logout(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  const family = familyOf(rawToken);
  await RefreshTokenModel.updateMany(
    { family, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

/** Fetch the public profile for the authenticated principal. */
export async function getMe(userId: string, role: Role): Promise<PublicUser> {
  const account = await findAccountById(userId, role);
  if (!account) throw ApiError.notFound('Account not found');
  return toPublicUser(account);
}

/** Change the authenticated account's password after verifying the current one. */
/**
 * Self-service password change. Clears `mustChangePassword` — the owner has now chosen their own
 * secret — and returns a **fresh access token** so the forced-change gate lifts on the next
 * request instead of after the old token expires.
 */
export async function changePassword(
  userId: string,
  role: Role,
  currentPassword: string,
  newPassword: string,
): Promise<{ accessToken: string }> {
  const hash = await getPasswordHashById(userId, role);
  if (!hash) throw ApiError.notFound('Account not found');
  const ok = await verifyPassword(currentPassword, hash);
  if (!ok) throw ApiError.badRequest('Current password is incorrect');
  if (currentPassword === newPassword) {
    throw ApiError.badRequest('New password must be different from the current one');
  }
  await setPasswordById(userId, role, await hashPassword(newPassword), false);
  const account = await findAccountById(userId, role);
  if (!account) throw ApiError.notFound('Account not found');
  return { accessToken: signAccessToken(principalOf(account)) };
}
