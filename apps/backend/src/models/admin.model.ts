import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { applyBaseTransforms } from './_shared.js';
import { Roles } from '../types/index.js';

/**
 * ADMIN accounts live in their own `admins` collection, separate from scanners and
 * personnel. `role` is fixed to ADMIN (kept on the doc so refs/principals read uniformly).
 */
const adminSchema = new Schema(
  {
    mobile: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      match: [/^\d{10}$/, 'Mobile must be 10 digits'],
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, default: Roles.ADMIN, immutable: true },
    name: { type: String, trim: true, default: '' },
    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export type Admin = InferSchemaType<typeof adminSchema>;
export type AdminDoc = HydratedDocument<Admin>;

applyBaseTransforms(adminSchema);

export const AdminModel = model('Admin', adminSchema);
