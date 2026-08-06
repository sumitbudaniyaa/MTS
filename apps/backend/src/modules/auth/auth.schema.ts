import { z } from 'zod';
import { Roles } from '../../types/index.js';

export const loginSchema = z.object({
  mobile: z.string().regex(/^\d{10}$/, 'Mobile must be 10 digits'),
  password: z.string().min(6).max(128),
  // Which app is logging in. Accounts are per-collection, so the same mobile can be an admin,
  // a scanner AND a user — the role scopes the lookup to the right collection.
  role: z.enum([Roles.ADMIN, Roles.SCANNER, Roles.USER]).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  // New passwords must be at least 8 chars (login still accepts existing 6-char passwords).
  newPassword: z.string().min(8).max(128),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// Which app is refreshing. Each app owns a SEPARATE refresh cookie (see auth.controller), so
// this picks the cookie to read/rotate/re-set. Optional for backwards compatibility with
// clients that still hold the old shared cookie.
// A bodyless POST must still be accepted (it just takes the legacy-cookie path), so an
// absent body is normalized to {} rather than failing validation with a 400.
export const refreshSchema = z.preprocess(
  (v) => v ?? {},
  z.object({ role: z.enum([Roles.ADMIN, Roles.SCANNER, Roles.USER]).optional() }),
);
export type RefreshInput = z.infer<typeof refreshSchema>;
