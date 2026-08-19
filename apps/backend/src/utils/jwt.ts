import crypto from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { env } from '../config/env.js';
import type { AuthPrincipal } from '../types/index.js';

/**
 * Access tokens are signed JWTs carrying the principal claims. Refresh tokens are opaque
 * high-entropy strings (not JWTs) — they are stored hashed server-side and rotated, so
 * statelessness is not desired for them. A refresh token also carries a `family` id used
 * for rotation + reuse detection.
 */

export function signAccessToken(principal: AuthPrincipal): string {
  const options: SignOptions = {
    expiresIn: env.ACCESS_TOKEN_TTL as SignOptions['expiresIn'],
    algorithm: 'HS256',
  };
  return jwt.sign(
    {
      role: principal.role,
      unit: principal.unit ?? null,
      ...(principal.mustChangePassword ? { mcp: true } : {}),
      // Epoch ms. Carried rather than pre-computed as a boolean so the deadline can pass
      // mid-token and the gate still notices immediately.
      ...(principal.passwordExpiresAt ? { pwx: principal.passwordExpiresAt } : {}),
    },
    env.JWT_ACCESS_SECRET,
    { ...options, subject: principal.sub },
  );
}

export function verifyAccessToken(token: string): AuthPrincipal {
  // Pin the algorithm so a token can't be forced through a different (or `none`) algorithm.
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
  }) as jwt.JwtPayload;
  return {
    sub: String(decoded.sub),
    role: decoded.role,
    mustChangePassword: decoded.mcp === true,
    passwordExpiresAt: typeof decoded.pwx === 'number' ? decoded.pwx : undefined,
    unit: decoded.unit ?? undefined,
  };
}

export interface IssuedRefreshToken {
  raw: string;
  hash: string;
  family: string;
  expiresAt: Date;
}

/** Mint a new opaque refresh token (optionally continuing an existing family on rotation). */
export function issueRefreshToken(family?: string): IssuedRefreshToken {
  const raw = `${family ?? nanoid()}.${nanoid(48)}`;
  return {
    raw,
    hash: hashRefreshToken(raw),
    family: family ?? raw.split('.')[0]!,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
  };
}

/** SHA-256 hash used for storing/looking up refresh tokens (never store the raw value). */
export function hashRefreshToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Extract the family id embedded as the prefix of a refresh token. */
export function familyOf(raw: string): string {
  return raw.split('.')[0] ?? '';
}
