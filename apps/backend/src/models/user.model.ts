import { applyBaseTransforms } from './_shared.js';
import { applyFieldEncryption } from '../utils/fieldCrypto.js';
import { Schema, model, type InferSchemaType, type HydratedDocument, type Types } from 'mongoose';
import { MaritalStatus, Rank } from '../constants/enums.js';
import { Roles } from '../types/index.js';

/**
 * Personnel (USER role only) accounts. Admins and scanners live in their own collections
 * (`admins`, `scanners`). Personnel-specific fields (unit, marital status, family) are
 * used to enforce per-person booking limits.
 *
 * `familySize` is ALWAYS derived server-side from marital status + kids and recomputed on
 * every save — the client-supplied value is never trusted. It caps how many tickets a
 * single user may hold for a movie.
 */
const userSchema = new Schema(
  {
    // Mobile number is the login identity. Stored ENCRYPTED at rest (AES-256-GCM); equality
    // lookups + uniqueness use the `mobileHash` blind index (added by applyFieldEncryption).
    // Format is validated at the Zod input layer before encryption.
    mobile: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    // The `users` collection holds personnel only; role is fixed to USER. Admins and
    // scanners live in their own `admins` / `scanners` collections.
    role: { type: String, default: Roles.USER, immutable: true },

    // Personnel-only fields:
    unit: { type: Schema.Types.ObjectId, ref: 'Unit', default: null, index: true },
    rank: { type: String, enum: Object.values(Rank), default: Rank.JAWAN, index: true },
    maritalStatus: {
      type: String,
      enum: Object.values(MaritalStatus),
      default: MaritalStatus.SINGLE,
    },
    // Encrypted at rest; alternate-login lookups use the `spouseMobileHash` blind index.
    spouseMobile: { type: String, default: null },
    numberOfKids: { type: Number, default: 0, min: 0, max: 20 },

    // Derived — see pre-validate hook. Never set from client input.
    familySize: { type: Number, default: 1, min: 1 },

    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/**
 * Recompute the authoritative family size on every write.
 * familySize = 1 (self) + (married ? 1 : 0) + numberOfKids.
 */
function computeFamilySize(doc: {
  maritalStatus?: string | null;
  numberOfKids?: number | null;
}): number {
  const hasSpouse = doc.maritalStatus === MaritalStatus.MARRIED ? 1 : 0;
  const kids = Math.max(0, doc.numberOfKids ?? 0);
  return 1 + hasSpouse + kids;
}

userSchema.pre('validate', function recomputeFamilySize(next) {
  // SINGLE personnel cannot have a spouse mobile.
  if (this.maritalStatus !== MaritalStatus.MARRIED) {
    this.spouseMobile = null;
  }
  this.familySize = computeFamilySize(this);
  next();
});

userSchema.index({ role: 1, unit: 1 });

export type User = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<User>;
export type UserId = Types.ObjectId;

applyBaseTransforms(userSchema);
// Encrypt mobile + spouse mobile at rest; add unique/sparse blind indexes for lookup.
applyFieldEncryption(userSchema, [
  { field: 'mobile', hash: 'mobileHash', unique: true },
  { field: 'spouseMobile', hash: 'spouseMobileHash' },
]);

export const UserModel = model('User', userSchema);
export { computeFamilySize };
