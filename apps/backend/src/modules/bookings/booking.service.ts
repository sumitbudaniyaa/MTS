import mongoose, { type Types } from 'mongoose';
import { runInTransaction } from '../../utils/transaction.js';
import {
  BookingModel,
  MovieModel,
  MovieSeatModel,
  SeatAllocationModel,
  UserModel,
  isMovieVisible,
  type BookingDoc,
} from '../../models/index.js';
import { ApiError } from '../../utils/apiError.js';
import { generateTicketCode } from '../../utils/ids.js';
import { recordAudit } from '../audit/audit.service.js';
import { broadcastSeats } from '../../realtime/gateway.js';
import {
  AuditAction,
  BookingSource,
  MovieStatus,
  SeatStatus,
  TicketStatus,
} from '../../constants/enums.js';
import { Roles } from '../../types/index.js';
import type { Request } from 'express';

const BOOKABLE = [MovieStatus.SCHEDULED, MovieStatus.OPEN, MovieStatus.POOL_RELEASED] as const;

interface CreateArgs {
  userId: string;
  unitId: string | null;
  movieId: string;
  quantity: number;
  idempotencyKey: string;
  req?: Request;
}

/** Count a user's still-valid (BOOKED or CHECKED_IN) tickets for a movie. */
async function heldTickets(
  userId: string,
  movieId: string,
  session: mongoose.ClientSession | undefined,
): Promise<number> {
  const rows = await BookingModel.aggregate<{ held: number }>([
    { $match: { user: new mongoose.Types.ObjectId(userId), movie: new mongoose.Types.ObjectId(movieId) } },
    { $unwind: '$tickets' },
    { $match: { 'tickets.status': { $in: [TicketStatus.BOOKED, TicketStatus.CHECKED_IN] } } },
    { $count: 'held' },
  ]).session(session ?? null);
  return rows[0]?.held ?? 0;
}

/**
 * Create a booking. The entire operation runs in a MongoDB transaction and uses atomic
 * conditional updates so seats can never be oversold under concurrency:
 *
 *  - UNIT_QUOTA path: `findOneAndUpdate` on the unit's allocation requiring
 *    `allocated - booked >= qty` before `$inc`-ing `booked`. A non-match means no capacity.
 *  - OPEN_POOL path (after pool release): atomically decrements `poolSeats` requiring
 *    `poolSeats >= qty`.
 *  - The movie's `seatsBooked` is bumped under a `totalSeats - seatsBooked >= qty` guard.
 *
 * Idempotency: a duplicate (user, idempotencyKey) returns the existing booking and performs
 * no seat changes (the unique index + transaction abort guarantees no double decrement).
 */
export async function createBooking(args: CreateArgs): Promise<BookingDoc> {
  const { userId, unitId, movieId, quantity, idempotencyKey, req } = args;

  // Fast idempotency path (avoids a pointless transaction on obvious retries).
  const prior = await BookingModel.findOne({ user: userId, idempotencyKey });
  if (prior) return prior;

  const user = await UserModel.findById(userId);
  if (!user) throw ApiError.unauthorized();

  try {
    let created: BookingDoc | null = null;
    await runInTransaction(async (session) => {
      const movie = await MovieModel.findById(movieId).session(session ?? null);
      if (!movie) throw ApiError.notFound('Movie not found');
      if (!BOOKABLE.includes(movie.status as (typeof BOOKABLE)[number])) {
        throw ApiError.conflict('Movie is not open for booking');
      }
      if (!isMovieVisible(movie)) throw ApiError.forbidden('Movie is not yet available');

      // Family-size cap (server-authoritative).
      const held = await heldTickets(userId, movieId, session);
      if (held + quantity > user.familySize) {
        throw ApiError.badRequest(
          `Family limit exceeded: you may hold at most ${user.familySize} tickets for this movie`,
          { familySize: user.familySize, held, requested: quantity },
        );
      }

      const pooled = movie.status === MovieStatus.POOL_RELEASED;
      const source = pooled ? BookingSource.OPEN_POOL : BookingSource.UNIT_QUOTA;
      let bookingUnit: Types.ObjectId | null = null;

      if (source === BookingSource.UNIT_QUOTA) {
        if (!unitId) throw ApiError.badRequest('User is not assigned to a unit');
        // Atomic quota guard — only succeeds if the unit has >= quantity free seats.
        const alloc = await SeatAllocationModel.findOneAndUpdate(
          {
            movie: movie._id,
            unit: unitId,
            $expr: { $gte: [{ $subtract: ['$allocated', '$booked'] }, quantity] },
          },
          { $inc: { booked: quantity } },
          { session: session ?? null, new: true },
        );
        if (!alloc) throw ApiError.conflict('Your unit has no remaining seats for this movie');
        bookingUnit = alloc.unit as Types.ObjectId;
      } else {
        // Atomic common-pool guard.
        const m = await MovieModel.findOneAndUpdate(
          { _id: movie._id, $expr: { $gte: ['$poolSeats', quantity] } },
          { $inc: { poolSeats: -quantity } },
          { session: session ?? null, new: true },
        );
        if (!m) throw ApiError.conflict('No seats left in the common pool');
      }

      // Movie-level capacity guard (defence in depth against any oversell).
      const capped = await MovieModel.findOneAndUpdate(
        {
          _id: movie._id,
          $expr: { $gte: [{ $subtract: ['$totalSeats', '$seatsBooked'] }, quantity] },
        },
        { $inc: { seatsBooked: quantity } },
        { session: session ?? null, new: true },
      );
      if (!capped) throw ApiError.conflict('Auditorium is sold out');

      const tickets = Array.from({ length: quantity }, () => ({
        code: generateTicketCode(),
        status: TicketStatus.BOOKED,
      }));

      const docs = await BookingModel.create(
        [{ user: userId, movie: movie._id, unit: bookingUnit, source, quantity, idempotencyKey, tickets }],
        { session: session ?? null },
      );
      created = docs[0]!;

      await recordAudit({
        action: AuditAction.BOOKING_CREATE,
        user: userId,
        role: Roles.USER,
        req,
        metadata: { bookingId: created.id, movieId, quantity, source },
        session,
      });
    });

    if (!created) throw ApiError.internal('Booking failed');
    return created;
  } catch (err) {
    // Concurrent duplicate idempotency key: the transaction aborted (no seat change) —
    // resolve to the winning booking and return it.
    if (isDuplicateKey(err)) {
      const existing = await BookingModel.findOne({ user: userId, idempotencyKey });
      if (existing) return existing;
    }
    throw err;
  }
}

/** Cancel a booking before showtime, releasing its seats back to quota or pool. */
export async function cancelBooking(
  bookingId: string,
  userId: string,
  req?: Request,
): Promise<BookingDoc> {
  let result: BookingDoc | null = null;
  await runInTransaction(async (session) => {
    const booking = await BookingModel.findOne({ _id: bookingId, user: userId }).session(session ?? null);
      if (!booking) throw ApiError.notFound('Booking not found');
      if (booking.cancelledAt) throw ApiError.conflict('Booking already cancelled');

    const movie = await MovieModel.findById(booking.movie).session(session ?? null);
      if (!movie) throw ApiError.notFound('Movie not found');
      if (Date.now() >= movie.startTime.getTime()) {
        throw ApiError.conflict('Cannot cancel after showtime');
      }

      // Only seats still BOOKED are releasable (checked-in/expired are not).
      const releasable = booking.tickets.filter((t) => t.status === TicketStatus.BOOKED);
      const count = releasable.length;
      if (count === 0) throw ApiError.conflict('No releasable tickets');

      releasable.forEach((t) => {
        t.status = TicketStatus.CANCELLED;
        t.cancelledAt = new Date();
      });
      booking.cancelledAt = new Date();
    await booking.save({ session: session ?? null });

      // Return seats: quota bookings restore unit quota; pool bookings restore the pool.
      if (booking.source === BookingSource.UNIT_QUOTA && booking.unit) {
        // Guard: only decrement if booked >= count — prevents negative values from
        // data corruption or edge cases (e.g. a booking created before the quota counter
        // was properly tracked).
        await SeatAllocationModel.updateOne(
          { movie: movie._id, unit: booking.unit, booked: { $gte: count } },
          { $inc: { booked: -count } },
          { session },
        );
      } else {
        await MovieModel.updateOne({ _id: movie._id }, { $inc: { poolSeats: count } }, { session });
      }
      await MovieModel.updateOne({ _id: movie._id }, { $inc: { seatsBooked: -count } }, { session });

      // Seat-based bookings: free the actual seats and push the change to the live map.
      const labels = releasable
        .map((t) => t.seatLabel)
        .filter((l): l is string => typeof l === 'string' && l.length > 0);
      if (labels.length > 0) {
        await MovieSeatModel.updateMany(
          { movie: movie._id, label: { $in: labels }, status: SeatStatus.BOOKED },
          { $set: { status: SeatStatus.FREE, bookedBy: null, booking: null, ticketCode: null } },
          { session },
        );
        broadcastSeats(
          String(movie._id),
          labels.map((label) => ({ label, status: 'FREE' as const })),
        );
      }

      await recordAudit({
        action: AuditAction.BOOKING_CANCEL,
        user: userId,
        role: Roles.USER,
        req,
        metadata: { bookingId, released: count },
        session,
      });
      result = booking;
  });
  if (!result) throw ApiError.internal('Cancellation failed');
  return result;
}

/** A user's bookings (most recent first), with movie summary for display. */
export async function listMyBookings(userId: string): Promise<BookingDoc[]> {
  return BookingModel.find({ user: userId })
    .populate('movie', 'title poster showDate startTime status')
    .sort('-createdAt');
}

export async function getMyBooking(bookingId: string, userId: string): Promise<BookingDoc> {
  const booking = await BookingModel.findOne({ _id: bookingId, user: userId }).populate(
    'movie',
    'title poster showDate startTime status',
  );
  if (!booking) throw ApiError.notFound('Booking not found');
  return booking;
}

/** How many more tickets this user may book for a movie (family limit minus held). */
export async function getAllowance(
  userId: string,
  movieId: string,
): Promise<{ familySize: number; held: number; remaining: number }> {
  const user = await UserModel.findById(userId);
  if (!user) throw ApiError.unauthorized();
  const held = await heldTickets(userId, movieId, undefined);
  return {
    familySize: user.familySize,
    held,
    remaining: Math.max(0, user.familySize - held),
  };
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}
