import { applyBaseTransforms } from './_shared.js';
import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { BookingSource, TicketStatus } from '../constants/enums.js';

/**
 * A ticket = one seat = one QR code. Tickets are embedded in their parent booking; the
 * `code` is globally unique (enforced by a unique index on `tickets.code`) so the scanner
 * can resolve and verify a QR in a single indexed query.
 */
const ticketSchema = new Schema(
  {
    code: { type: String, required: true }, // opaque QR payload (nanoid)
    seatLabel: { type: String, default: null }, // e.g. "A1" (seat-based bookings)
    status: {
      type: String,
      enum: Object.values(TicketStatus),
      default: TicketStatus.BOOKED,
    },
    checkedIn: { type: Boolean, default: false },
    checkedInAt: { type: Date, default: null },
    // Who scanned it. Polymorphic (like `auditlogs`) because door staff are Scanner accounts
    // but an operational ADMIN can also scan from their own console — a hard `ref: 'Scanner'`
    // would store an Admin id that populates to null, silently losing who checked the ticket in.
    checkedInBy: {
      type: Schema.Types.ObjectId,
      refPath: 'tickets.checkedInByModel',
      default: null,
    },
    checkedInByModel: { type: String, enum: ['Scanner', 'Admin'], default: null },
    cancelledAt: { type: Date, default: null },
    expiredAt: { type: Date, default: null },
  },
  { _id: true },
);

/**
 * A booking groups the tickets a single user holds for one movie, from one source
 * (unit quota or open pool). Idempotency: a unique (user, idempotencyKey) index makes
 * client retries safe — a duplicate create resolves to the existing booking.
 */
const bookingSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    movie: { type: Schema.Types.ObjectId, ref: 'Movie', required: true, index: true },
    unit: { type: Schema.Types.ObjectId, ref: 'Unit', default: null }, // null for OPEN_POOL
    source: {
      type: String,
      enum: Object.values(BookingSource),
      required: true,
    },
    quantity: { type: Number, required: true, min: 1 },
    idempotencyKey: { type: String, required: true },
    tickets: { type: [ticketSchema], default: [] },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true, optimisticConcurrency: true },
);

// Idempotent creation guard.
bookingSchema.index({ user: 1, idempotencyKey: 1 }, { unique: true });
// Fast QR lookup + uniqueness of ticket codes across the whole system.
bookingSchema.index({ 'tickets.code': 1 }, { unique: true, sparse: true });

export type Ticket = InferSchemaType<typeof ticketSchema>;
export type Booking = InferSchemaType<typeof bookingSchema>;
export type BookingDoc = HydratedDocument<Booking>;

applyBaseTransforms(bookingSchema);

export const BookingModel = model('Booking', bookingSchema);
