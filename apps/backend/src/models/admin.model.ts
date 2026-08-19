import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { applyBaseTransforms } from './_shared.js';
import { applyFieldEncryption } from '../utils/fieldCrypto.js';
import { Roles } from '../types/index.js';

/**
 * Admin accounts live in their own `admins` collection, separate from scanners and personnel.
 * This collection holds BOTH tiers: SUPER_ADMIN (top; manages people + admin accounts) and
 * ADMIN (operational; manages movies/auditorium/bookings). `role` is set at creation.
 */
const adminSchema = new Schema(
  {
    // Encrypted at rest; lookups/uniqueness use the `mobileHash` blind index.
    mobile: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: [Roles.SUPER_ADMIN, Roles.ADMIN],
      default: Roles.ADMIN,
      immutable: true,
    },
    name: { type: String, trim: true, default: '' },
    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
    // Set whenever SOMEONE ELSE chose this account's password — the shared default on
    // creation, or an admin resetting it. Cleared only when the owner sets their own. While it
    // is true the API refuses everything except reading yourself and changing your password.
    mustChangePassword: { type: Boolean, default: false },
    // Deadline for that change. Until it passes the account works normally and the apps nudge;
    // after it, the API refuses everything but reading yourself and setting a new password.
    passwordExpiresAt: { type: Date, default: null },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true },
);

export type Admin = InferSchemaType<typeof adminSchema>;
export type AdminDoc = HydratedDocument<Admin>;

applyBaseTransforms(adminSchema);
applyFieldEncryption(adminSchema, [{ field: 'mobile', hash: 'mobileHash', unique: true }]);

export const AdminModel = model('Admin', adminSchema);
