import { runInTransaction } from '../utils/transaction.js';
import { BookingModel, MovieModel, MovieSeatModel } from '../models/index.js';
import { MovieStatus, SeatStatus, TicketStatus } from '../constants/enums.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { broadcastSeats } from '../realtime/gateway.js';

/**
 * No-show expiry. `NO_SHOW_GRACE_MINUTES` after showtime, any ticket still BOOKED and not
 * checked in is marked EXPIRED and its seat is FREED on the live seat map (status BOOKED ->
 * FREE) — because the movie stays bookable until its end time, walk-ins can immediately grab
 * those seats.
 *
 * Idempotent: guarded by `noShowProcessedAt`. Each movie processed in its own transaction.
 *
 * @returns number of tickets expired this run.
 */
export async function expireNoShows(now: Date = new Date()): Promise<number> {
  const graceMs = env.NO_SHOW_GRACE_MINUTES * 60_000;
  const cutoff = new Date(now.getTime() - graceMs);

  const due = await MovieModel.find({
    status: { $in: [MovieStatus.OPEN, MovieStatus.SCHEDULED, MovieStatus.POOL_RELEASED] },
    startTime: { $lte: cutoff },
    noShowProcessedAt: null,
  }).select('_id');

  let expiredTotal = 0;
  for (const { _id } of due) {
    // Seats freed for this movie (collected inside the txn, broadcast after it commits).
    let freedLabels: string[] = [];
    try {
      await runInTransaction(async (session) => {
        const movie = await MovieModel.findById(_id).session(session ?? null);
        if (!movie || movie.noShowProcessedAt) return; // idempotent re-check

        const bookings = await BookingModel.find({
          movie: _id,
          'tickets.status': TicketStatus.BOOKED,
        }).session(session ?? null);

        let expired = 0;
        const labels: string[] = [];
        for (const booking of bookings) {
          let changed = 0;
          for (const t of booking.tickets) {
            if (t.status === TicketStatus.BOOKED && !t.checkedIn) {
              t.status = TicketStatus.EXPIRED;
              t.expiredAt = now;
              changed += 1;
              if (t.seatLabel) labels.push(t.seatLabel);
            }
          }
          if (changed > 0) {
            await booking.save({ session: session ?? null });
            expired += changed;
          }
        }

        if (expired > 0) {
          // Free the actual seat inventory so the seats are re-bookable during the show.
          if (labels.length > 0) {
            await MovieSeatModel.updateMany(
              { movie: _id, label: { $in: labels }, status: SeatStatus.BOOKED },
              { $set: { status: SeatStatus.FREE, bookedBy: null, booking: null, ticketCode: null } },
              { session: session ?? undefined },
            );
          }
          // Keep the legacy pool counters coherent as well.
          movie.seatsBooked = Math.max(0, movie.seatsBooked - expired);
          movie.poolSeats += expired;
        }
        movie.noShowProcessedAt = now;
        await movie.save({ session: session ?? null });
        expiredTotal += expired;
        freedLabels = labels;
        logger.info({ movieId: String(_id), expired }, '[job] no-shows expired');
      });

      // Push freed seats to anyone watching the live map (after the txn commits).
      if (freedLabels.length > 0) {
        broadcastSeats(
          String(_id),
          freedLabels.map((label) => ({ label, status: 'FREE' as const })),
        );
      }
    } catch (err) {
      logger.error({ err, movieId: String(_id) }, '[job] no-show expiry failed');
    }
  }
  return expiredTotal;
}
