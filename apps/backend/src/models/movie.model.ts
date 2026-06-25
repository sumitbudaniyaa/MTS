import { applyBaseTransforms } from './_shared.js';
import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { MovieStatus } from '../constants/enums.js';
import { env } from '../config/env.js';

/**
 * A movie show. Seat economy is tracked at two levels:
 *  - per-unit quota (see SeatAllocation)
 *  - movie totals: `seatsBooked` is the authoritative count of issued (non-released) seats
 *    and is guarded by atomic conditional updates to prevent overselling.
 *
 * `poolSeats` holds seats available to ANY user: unused unit quota released at startTime
 * plus seats freed by no-show expiry.
 */
const movieSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    poster: { type: String, trim: true, default: '' }, // URL / asset path

    showDate: { type: Date, required: true },
    startTime: { type: Date, required: true, index: true },

    totalSeats: { type: Number, required: true, min: 1 },
    seatsBooked: { type: Number, default: 0, min: 0 }, // issued seats (quota + pool)
    poolSeats: { type: Number, default: 0, min: 0 }, // common-pool seats available to anyone

    status: {
      type: String,
      enum: Object.values(MovieStatus),
      default: MovieStatus.DRAFT,
      index: true,
    },

    // Admin override: when true, any rank may book any seat for this movie (free-for-all),
    // ignoring per-seat rank restrictions.
    openToAll: { type: Boolean, default: false },

    // Job bookkeeping (idempotent reconciliation).
    poolReleasedAt: { type: Date, default: null },
    noShowProcessedAt: { type: Date, default: null },
  },
  { timestamps: true, optimisticConcurrency: true },
);

export type Movie = InferSchemaType<typeof movieSchema>;
export type MovieDoc = HydratedDocument<Movie>;

applyBaseTransforms(movieSchema);

export const MovieModel = model('Movie', movieSchema);

/** True once the visibility window (startTime - VISIBILITY_LEAD_MINUTES) has opened. */
export function isMovieVisible(
  movie: Pick<Movie, 'startTime'>,
  now: Date = new Date(),
): boolean {
  const lead = env.VISIBILITY_LEAD_MINUTES * 60_000;
  return now.getTime() >= movie.startTime.getTime() - lead;
}
