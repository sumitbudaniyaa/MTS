import { applyBaseTransforms } from './_shared.js';
import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { MovieStatus } from '../constants/enums.js';
import { settings } from '../config/settings.js';

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
    // Show length in minutes; endTime = startTime + durationMinutes. Booking stays open (and
    // the movie stays listed) until the end time.
    durationMinutes: { type: Number, default: 180, min: 1 },

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

/** When the show ends: startTime + durationMinutes (defaults to 180 min if unset). */
export function movieEndTime(
  movie: Pick<Movie, 'startTime' | 'durationMinutes'>,
): Date {
  const mins = movie.durationMinutes ?? 180;
  return new Date(movie.startTime.getTime() + mins * 60_000);
}

/**
 * True while booking is open: from `startTime - visibilityLeadMinutes` until the show's end
 * time. Movies are listed to users earlier than this, but seats are only bookable in-window.
 */
export function isMovieVisible(
  movie: Pick<Movie, 'startTime' | 'durationMinutes'>,
  now: Date = new Date(),
): boolean {
  const lead = settings().visibilityLeadMinutes * 60_000;
  const t = now.getTime();
  return t >= movie.startTime.getTime() - lead && t < movieEndTime(movie).getTime();
}
