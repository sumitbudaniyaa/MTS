import { runInTransaction } from '../utils/transaction.js';
import { BookingModel, MovieModel } from '../models/index.js';
import { MovieStatus, TicketStatus } from '../constants/enums.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * No-show expiry. `NO_SHOW_GRACE_MINUTES` after showtime, any ticket still BOOKED and not
 * checked in is marked EXPIRED and its seat returned to the common pool (so late arrivals /
 * walk-ins can be re-seated).
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
    try {
      await runInTransaction(async (session) => {
        const movie = await MovieModel.findById(_id).session(session ?? null);
        if (!movie || movie.noShowProcessedAt) return; // idempotent re-check

        const bookings = await BookingModel.find({
          movie: _id,
          'tickets.status': TicketStatus.BOOKED,
        }).session(session ?? null);

        let expired = 0;
        for (const booking of bookings) {
          let changed = 0;
          for (const t of booking.tickets) {
            if (t.status === TicketStatus.BOOKED && !t.checkedIn) {
              t.status = TicketStatus.EXPIRED;
              t.expiredAt = now;
              changed += 1;
            }
          }
          if (changed > 0) {
            await booking.save({ session: session ?? null });
            expired += changed;
          }
        }

        if (expired > 0) {
          // Seats no longer occupied -> back to the common pool.
          movie.seatsBooked = Math.max(0, movie.seatsBooked - expired);
          movie.poolSeats += expired;
        }
        movie.noShowProcessedAt = now;
        await movie.save({ session: session ?? null });
        expiredTotal += expired;
        logger.info({ movieId: String(_id), expired }, '[job] no-shows expired');
      });
    } catch (err) {
      logger.error({ err, movieId: String(_id) }, '[job] no-show expiry failed');
    }
  }
  return expiredTotal;
}
