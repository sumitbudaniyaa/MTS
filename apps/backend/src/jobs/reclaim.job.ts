import { runInTransaction } from '../utils/transaction.js';
import { BookingModel, MovieModel, MovieSeatModel, movieEndTime } from '../models/index.js';
import { MovieStatus, SeatStatus, TicketStatus } from '../constants/enums.js';
import { settings } from '../config/settings.js';
import { logger } from '../config/logger.js';
import { broadcastSeats } from '../realtime/gateway.js';

/**
 * Reclaims seats whose holder never checked in, and frees them on the live map so someone
 * else can take them while the show is still running.
 *
 * Each ticket is judged against its OWN deadline rather than one deadline for the whole
 * movie, because the two cohorts are genuinely different:
 *
 *  - Booked before the show started → deadline is `startTime + grace`, and failing it is a
 *    real no-show (`EXPIRED`): the seat was reserved in advance and wasted.
 *  - Booked after the show started (a walk-in taking a seat this job just freed) → deadline
 *    is `bookedAt + grace`, so they get the same grace measured from when they booked rather
 *    than being reclaimed on the very next tick. Failing it is `RELEASED`, not a no-show —
 *    they were already in the building, and counting them against attendance would corrupt
 *    the only figure that means anything.
 *
 * Every deadline is capped at the show's end time, so no ticket is still awaiting check-in
 * once the movie is over and the report becomes available.
 *
 * Idempotent. While a movie is running it is re-examined every tick; `noShowProcessedAt` is
 * stamped only by the final sweep after the end time, which retires the movie for good.
 *
 * @returns number of seats reclaimed this run.
 */
export async function reclaimUnclaimedSeats(now: Date = new Date()): Promise<number> {
  const graceMs = settings().noShowGraceMinutes * 60_000;

  // Candidates: the earliest deadline any of their tickets could have (startTime + grace) has
  // passed, and the final post-show sweep hasn't retired them yet.
  const due = await MovieModel.find({
    status: { $in: [MovieStatus.OPEN, MovieStatus.SCHEDULED, MovieStatus.POOL_RELEASED] },
    startTime: { $lte: new Date(now.getTime() - graceMs) },
    noShowProcessedAt: null,
  }).select('_id');

  let reclaimedTotal = 0;
  for (const { _id } of due) {
    let freedLabels: string[] = [];
    try {
      await runInTransaction(async (session) => {
        const movie = await MovieModel.findById(_id).session(session ?? null);
        if (!movie || movie.noShowProcessedAt) return; // idempotent re-check

        const endsAt = movieEndTime(movie).getTime();
        const ended = now.getTime() >= endsAt;
        const startedAt = movie.startTime.getTime();

        const bookings = await BookingModel.find({
          movie: _id,
          'tickets.status': TicketStatus.BOOKED,
        }).session(session ?? null);

        let noShows = 0; // reserved in advance, never turned up
        let released = 0; // walk-in seats handed back
        const labels: string[] = [];

        for (const booking of bookings) {
          const bookedAt = (booking as unknown as { createdAt: Date }).createdAt.getTime();
          const isWalkIn = bookedAt > startedAt;
          const deadline = Math.min(Math.max(startedAt, bookedAt) + graceMs, endsAt);
          if (now.getTime() < deadline) continue;

          let changed = 0;
          for (const t of booking.tickets) {
            if (t.status === TicketStatus.BOOKED && !t.checkedIn) {
              t.status = isWalkIn ? TicketStatus.RELEASED : TicketStatus.EXPIRED;
              t.expiredAt = now;
              changed += 1;
              if (t.seatLabel) labels.push(t.seatLabel);
            }
          }
          if (changed > 0) {
            await booking.save({ session: session ?? null });
            if (isWalkIn) released += changed;
            else noShows += changed;
          }
        }

        const reclaimed = noShows + released;
        if (reclaimed > 0) {
          // Free the actual seat inventory so the seats are re-bookable during the show.
          if (labels.length > 0) {
            await MovieSeatModel.updateMany(
              { movie: _id, label: { $in: labels }, status: SeatStatus.BOOKED },
              { $set: { status: SeatStatus.FREE, bookedBy: null, booking: null, ticketCode: null } },
              { session: session ?? undefined },
            );
          }
          // Keep the pool counters coherent as well.
          movie.seatsBooked = Math.max(0, movie.seatsBooked - reclaimed);
          movie.poolSeats += reclaimed;
        }
        // Only the post-show sweep retires the movie; until then it stays in the rotation.
        // Retiring also moves it to its terminal status, so a finished show stops presenting
        // itself as POOL_RELEASED (i.e. still selling seats) for the rest of time.
        if (ended) {
          movie.noShowProcessedAt = now;
          movie.status = MovieStatus.COMPLETED;
        }
        await movie.save({ session: session ?? null });

        reclaimedTotal += reclaimed;
        freedLabels = labels;
        if (reclaimed > 0) {
          logger.info({ movieId: String(_id), noShows, released }, '[job] seats reclaimed');
        }
      });

      // Push freed seats to anyone watching the live map (after the txn commits).
      if (freedLabels.length > 0) {
        broadcastSeats(
          String(_id),
          freedLabels.map((label) => ({ label, status: 'FREE' as const })),
        );
      }
    } catch (err) {
      logger.error({ err, movieId: String(_id) }, '[job] seat reclaim failed');
    }
  }
  return reclaimedTotal;
}
