import { runInTransaction } from '../utils/transaction.js';
import { MovieModel, SeatAllocationModel } from '../models/index.js';
import { MovieStatus } from '../constants/enums.js';
import { logger } from '../config/logger.js';

/**
 * Open-pool release. At (or after) a movie's start time, each unit's unused quota
 * (`allocated - booked`) is moved into the common pool so ANY user can book it.
 *
 * **Opt-in.** Only movies an admin has marked "Open to all" (`openToAll`) are released.
 * Releasing was previously automatic for every movie, which quietly dissolved the unit split
 * on every single show — the thing the allocations exist to express. Handing a unit's unused
 * seats to everyone is a decision, so it now takes the admin pressing the button; a movie left
 * restricted keeps its per-unit quota for its whole run and simply never reaches
 * POOL_RELEASED. Showtime is still the moment it happens, because that is when leftover quota
 * stops being worth holding.
 *
 * Idempotent: guarded by `poolReleasedAt`; safe to run repeatedly and to reconcile a
 * missed tick. Each movie is processed in its own transaction.
 *
 * @returns number of movies released this run.
 */
export async function releaseOpenPool(now: Date = new Date()): Promise<number> {
  const due = await MovieModel.find({
    status: { $in: [MovieStatus.SCHEDULED, MovieStatus.OPEN] },
    startTime: { $lte: now },
    poolReleasedAt: null,
    openToAll: true,
  }).select('_id');

  let released = 0;
  for (const { _id } of due) {
    try {
      await runInTransaction(async (session) => {
        const movie = await MovieModel.findById(_id).session(session ?? null);
        // Re-check inside the txn: idempotent, and the admin may have switched "Open to all"
        // back off between the query and here.
        if (!movie || movie.poolReleasedAt || !movie.openToAll) return;

        const allocations = await SeatAllocationModel.find({ movie: _id }).session(session ?? null);
        let unused = 0;
        for (const a of allocations) {
          const free = Math.max(0, a.allocated - a.booked);
          if (free > 0) {
            a.released += free;
            await a.save({ session: session ?? null });
            unused += free;
          }
        }

        movie.poolSeats += unused;
        movie.status = MovieStatus.POOL_RELEASED;
        movie.poolReleasedAt = now;
        await movie.save({ session: session ?? null });
        released += 1;
        logger.info({ movieId: String(_id), unused }, '[job] open-pool released');
      });
    } catch (err) {
      logger.error({ err, movieId: String(_id) }, '[job] open-pool release failed');
    }
  }
  return released;
}
