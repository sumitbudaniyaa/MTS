import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { applyBaseTransforms } from './_shared.js';
import { Rank, SeatStatus } from '../constants/enums.js';

/**
 * Per-movie seat inventory, generated from the auditorium layout. One document per seat per
 * movie. This is the source of truth for seat availability and the rank gate.
 *
 * Concurrency: holds and bookings use atomic conditional `findOneAndUpdate` on `status` so
 * two users can never grab the same seat. Expired holds are reclaimed by a scheduled job.
 */
const movieSeatSchema = new Schema(
  {
    movie: { type: Schema.Types.ObjectId, ref: 'Movie', required: true, index: true },
    row: { type: String, required: true },
    number: { type: Number, required: true },
    label: { type: String, required: true }, // e.g. "A1"
    allowedRanks: { type: [{ type: String, enum: Object.values(Rank) }], default: [] },

    status: {
      type: String,
      enum: Object.values(SeatStatus),
      default: SeatStatus.FREE,
      index: true,
    },
    heldBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    holdExpiresAt: { type: Date, default: null },

    bookedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    booking: { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
    ticketCode: { type: String, default: null },
  },
  { timestamps: true },
);

movieSeatSchema.index({ movie: 1, label: 1 }, { unique: true });
movieSeatSchema.index({ holdExpiresAt: 1 });

export type MovieSeat = InferSchemaType<typeof movieSeatSchema>;
export type MovieSeatDoc = HydratedDocument<MovieSeat>;

applyBaseTransforms(movieSeatSchema);

export const MovieSeatModel = model('MovieSeat', movieSeatSchema);
