import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { applyBaseTransforms } from './_shared.js';
import { Roles } from '../types/index.js';

/**
 * SCANNER (door-verification operator) accounts live in their own `scanners` collection,
 * separate from admins and personnel.
 */
const scannerSchema = new Schema(
  {
    mobile: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      match: [/^\d{10}$/, 'Mobile must be 10 digits'],
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, default: Roles.SCANNER, immutable: true },
    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export type Scanner = InferSchemaType<typeof scannerSchema>;
export type ScannerDoc = HydratedDocument<Scanner>;

applyBaseTransforms(scannerSchema);

export const ScannerModel = model('Scanner', scannerSchema);
