import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { applyBaseTransforms } from './_shared.js';
import { Rank } from '../constants/enums.js';

/**
 * The physical auditorium layout (a single shared venue definition). The admin designs it
 * as rows of seats, and assigns which RANKS may book each row. Movies generate their own
 * per-seat inventory (MovieSeat) from this layout.
 */
const seatDefSchema = new Schema(
  {
    number: { type: Number, required: true, min: 1 },
    // Ranks allowed to book this seat. Empty array = open to all ranks.
    allowedRanks: { type: [{ type: String, enum: Object.values(Rank) }], default: [] },
  },
  { _id: false },
);

const rowSchema = new Schema(
  {
    label: { type: String, required: true, trim: true }, // e.g. "A"
    seats: { type: [seatDefSchema], default: [] },
  },
  { _id: false },
);

const auditoriumSchema = new Schema(
  {
    name: { type: String, default: 'Main Auditorium', trim: true },
    rows: { type: [rowSchema], default: [] },
  },
  { timestamps: true },
);

export type Auditorium = InferSchemaType<typeof auditoriumSchema>;
export type AuditoriumDoc = HydratedDocument<Auditorium>;

applyBaseTransforms(auditoriumSchema);

export const AuditoriumModel = model('Auditorium', auditoriumSchema);

/** Total seat count for a layout. */
export function countSeats(rows: Auditorium['rows']): number {
  return rows.reduce((sum, r) => sum + r.seats.length, 0);
}
