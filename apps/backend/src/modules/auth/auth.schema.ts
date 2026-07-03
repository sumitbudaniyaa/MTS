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
  newPassword: z.string().min(6).max(128),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
