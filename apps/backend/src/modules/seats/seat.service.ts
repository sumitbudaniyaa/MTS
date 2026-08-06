import { runInTransaction } from '../../utils/transaction.js';
import {
  MovieModel,
  SeatAllocationModel,
  UnitModel,
  type SeatAllocationDoc,
} from '../../models/index.js';
import { ApiError } from '../../utils/apiError.js';
import { MovieStatus } from '../../constants/enums.js';
import type { SetAllocationsInput } from './seat.schema.js';

/**
 * Replace all per-unit allocations for a movie in a single transaction.
 *
 * Invariants enforced:
 *  - the movie exists, has not started, and is not in a terminal state;
 *  - every referenced unit exists;
 *  - sum(allocated) === movie.totalSeats (full auditorium capacity);
 *  - an allocation cannot be reduced below seats already booked against it.
 */
export async function setAllocations(
  movieId: string,
  input: SetAllocationsInput,
  now: Date = new Date(),
): Promise<SeatAllocationDoc[]> {
  const movie = await MovieModel.findById(movieId);
  if (!movie) throw ApiError.notFound('Movie not found');

  // Quota freezes the moment the show starts: at startTime the open-pool job moves every
  // unit's unused quota into the common pool, and re-cutting quota afterwards would hand out
  // seats that have already been given away. This is checked against the clock rather than
  // the status because the job runs on a one-minute tick — inside that gap a started movie is
  // still SCHEDULED/OPEN, and a status check would wave the edit through.
  if (now.getTime() >= movie.startTime.getTime()) {
    throw ApiError.conflict('Allocations are locked once the show has started', {
      startTime: movie.startTime,
    });
  }
  // Terminal states an admin can reach before startTime.
  if (movie.status === MovieStatus.CLOSED || movie.status === MovieStatus.CANCELLED) {
    throw ApiError.conflict(`Allocations are locked for a ${movie.status.toLowerCase()} movie`);
  }

  const total = input.allocations.reduce((sum, a) => sum + a.allocated, 0);
  if (total !== movie.totalSeats) {
    throw ApiError.badRequest(
      `Sum of allocations (${total}) must equal total auditorium capacity (${movie.totalSeats})`,
      { total, totalSeats: movie.totalSeats },
    );
  }

  // Validate all units exist.
  const unitIds = input.allocations.map((a) => a.unit);
  const unitCount = await UnitModel.countDocuments({ _id: { $in: unitIds } });
  if (unitCount !== unitIds.length) throw ApiError.badRequest('One or more units do not exist');

  return runInTransaction(async (session) => {
    const existing = await SeatAllocationModel.find({ movie: movieId }).session(session ?? null);
      const bookedByUnit = new Map(existing.map((e) => [String(e.unit), e.booked]));

      // Reducing below already-booked seats would corrupt the quota — reject.
      for (const a of input.allocations) {
        const alreadyBooked = bookedByUnit.get(a.unit) ?? 0;
        if (a.allocated < alreadyBooked) {
          throw ApiError.conflict(
            `Unit ${a.unit}: cannot allocate ${a.allocated} seats; ${alreadyBooked} already booked`,
          );
        }
      }
      // A unit being removed entirely must have zero bookings.
      const keep = new Set(unitIds);
      for (const e of existing) {
        if (!keep.has(String(e.unit)) && e.booked > 0) {
          throw ApiError.conflict(`Cannot remove unit ${String(e.unit)} with existing bookings`);
        }
      }

      await SeatAllocationModel.deleteMany({ movie: movieId }).session(session ?? null);
      const docs = await SeatAllocationModel.create(
        input.allocations.map((a) => ({
          movie: movieId,
          unit: a.unit,
          allocated: a.allocated,
          booked: bookedByUnit.get(a.unit) ?? 0,
          released: 0,
        })),
        { session: session ?? null, ordered: true },
      );

      // Movie becomes SCHEDULED once fully allocated.
      if (movie.status === MovieStatus.DRAFT) {
        movie.status = MovieStatus.SCHEDULED;
        await movie.save({ session: session ?? null });
      }
      return docs;
  });
}

export async function listAllocations(movieId: string): Promise<SeatAllocationDoc[]> {
  const movie = await MovieModel.findById(movieId);
  if (!movie) throw ApiError.notFound('Movie not found');
  return SeatAllocationModel.find({ movie: movieId }).populate('unit', 'name').sort('unit');
}
