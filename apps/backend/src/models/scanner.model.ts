import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { applyBaseTransforms } from './_shared.js';
import { applyFieldEncryption } from '../utils/fieldCrypto.js';
import { Roles } from '../types/index.js';

/**
 * SCANNER (door-verification operator) accounts live in their own `scanners` collection,
 * separate from admins and personnel.
 */
const scannerSchema = new Schema(
  {
    // Encrypted at rest; lookups/uniqueness use the `mobileHash` blind index.
    mobile: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, default: Roles.SCANNER, immutable: true },
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

export type Scanner = InferSchemaType<typeof scannerSchema>;
export type ScannerDoc = HydratedDocument<Scanner>;

applyBaseTransforms(scannerSchema);
applyFieldEncryption(scannerSchema, [{ field: 'mobile', hash: 'mobileHash', unique: true }]);

export const ScannerModel = model('Scanner', scannerSchema);
