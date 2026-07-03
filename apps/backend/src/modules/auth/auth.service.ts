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
}

function toPublicUser(account: Account): PublicUser {
  return {
    id: account.id,
    mobile: account.mobile,
    name: account.name,
    role: account.role,
    unit: account.unit,
  };
}

function principalOf(account: Account): AuthPrincipal {
  return {
    sub: account.id,
    role: account.role,
    unit: account.unit ?? undefined,
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
  // Always run a verify to keep timing roughly constant whether or not the account exists.
  const hash = account?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinv';
  const ok = await verifyPassword(password, hash);
  if (!account || !ok) throw ApiError.unauthorized('Invalid credentials');
  if (!account.active) throw ApiError.forbidden('Account is disabled');

  await account.touchLogin();

  const accessToken = signAccessToken(principalOf(account));
  const refresh = issueRefreshToken();
  await persistRefresh(account, refresh, req);

  return { accessToken, refresh, user: toPublicUser(account) };
}

/**
 * Rotate a refresh token. Resilient to the rotation race (concurrent tabs / a reload firing
 * two refreshes): a token that was already rotated (revoked WITH a successor) and hasn't
 * expired is still accepted — we just mint a fresh token in the same family. Only a token
 * that was revoked WITHOUT a successor (i.e. logged out) or is unknown/expired is rejected,
 * so legitimate sessions are never spuriously logged out.
 */
export async function rotateRefresh(rawToken: string, req?: Request): Promise<AuthTokens> {
  const tokenHash = hashRefreshToken(rawToken);
  const existing = await RefreshTokenModel.findOne({ tokenHash });

  if (!existing) throw ApiError.unauthorized('Invalid refresh token');
  if (existing.expiresAt.getTime() <= Date.now()) {
    throw ApiError.unauthorized('Refresh token expired');
  }
  // Revoked by logout (no successor) — genuinely dead.
  if (existing.revokedAt && !existing.replacedBy) {
    throw ApiError.unauthorized('Refresh token already used');
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
export async function changePassword(
  userId: string,
  role: Role,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const hash = await getPasswordHashById(userId, role);
  if (!hash) throw ApiError.notFound('Account not found');
  const ok = await verifyPassword(currentPassword, hash);
  if (!ok) throw ApiError.badRequest('Current password is incorrect');
  await setPasswordById(userId, role, await hashPassword(newPassword));
}
