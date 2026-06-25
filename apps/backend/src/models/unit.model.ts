import { applyBaseTransforms } from './_shared.js';
import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * Army unit (e.g. Signals, Engineers, ASC). Personnel belong to exactly one unit and
 * seat allocations are granted per unit per movie.
 */
const unitSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export type Unit = InferSchemaType<typeof unitSchema>;
export type UnitDoc = HydratedDocument<Unit>;

applyBaseTransforms(unitSchema);

export const UnitModel = model('Unit', unitSchema);
