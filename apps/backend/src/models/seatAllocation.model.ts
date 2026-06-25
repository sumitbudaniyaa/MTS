import { applyBaseTransforms } from './_shared.js';
import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * Per-unit seat quota for a single movie. The sum of `allocated` across all units for a
 * movie must equal `movie.totalSeats` (validated at allocation time).
 *
 * Concurrency invariant: a quota booking is only permitted via an atomic conditional
 * update requiring `allocated - booked + released >= qty`-style guards, so `booked` can
 * never exceed `allocated`. `released` counts seats pushed to the common pool at startTime.
 */
const seatAllocationSchema = new Schema(
  {
    movie: { type: Schema.Types.ObjectId, ref: 'Movie', required: true, index: true },
    unit: { type: Schema.Types.ObjectId, ref: 'Unit', required: true, index: true },
    allocated: { type: Number, required: true, min: 0 },
    booked: { type: Number, default: 0, min: 0 }, // seats booked against this quota
    released: { type: Number, default: 0, min: 0 }, // unused quota moved to common pool
  },
  { timestamps: true, optimisticConcurrency: true },
);

// One allocation row per (movie, unit).
seatAllocationSchema.index({ movie: 1, unit: 1 }, { unique: true });

export type SeatAllocation = InferSchemaType<typeof seatAllocationSchema>;
export type SeatAllocationDoc = HydratedDocument<SeatAllocation>;

applyBaseTransforms(seatAllocationSchema);

export const SeatAllocationModel = model('SeatAllocation', seatAllocationSchema);
