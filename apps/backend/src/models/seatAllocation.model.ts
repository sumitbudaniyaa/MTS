import { applyBaseTransforms } from './_shared.js';
import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { Rank } from '../constants/enums.js';

/**
 * Per-unit, per-rank seat quota for a single movie.
 */
const seatAllocationSchema = new Schema(
  {
    movie: { type: Schema.Types.ObjectId, ref: 'Movie', required: true, index: true },
    unit: { type: Schema.Types.ObjectId, ref: 'Unit', required: true, index: true },
    rank: { type: String, enum: Object.values(Rank), default: Rank.JAWAN, required: true },
    allocated: { type: Number, required: true, min: 0 },
    booked: { type: Number, default: 0, min: 0 }, // seats booked against this quota
    released: { type: Number, default: 0, min: 0 }, // unused quota moved to common pool
  },
  { timestamps: true, optimisticConcurrency: true },
);

// One allocation row per (movie, unit, rank).
seatAllocationSchema.index({ movie: 1, unit: 1, rank: 1 }, { unique: true });

export type SeatAllocation = InferSchemaType<typeof seatAllocationSchema>;
export type SeatAllocationDoc = HydratedDocument<SeatAllocation>;

applyBaseTransforms(seatAllocationSchema);

export const SeatAllocationModel = model('SeatAllocation', seatAllocationSchema);
