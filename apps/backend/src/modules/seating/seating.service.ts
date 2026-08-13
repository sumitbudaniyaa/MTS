import type { Request } from 'express';
import { Types } from 'mongoose';
import {
  AuditoriumModel,
  BookingModel,
  MovieModel,
  MovieSeatModel,
  SeatAllocationModel,
  UserModel,
  countSeats,
  isMovieVisible,
  movieEndTime,
  type Auditorium,
  type MovieSeatDoc,
} from '../../models/index.js';
import { ApiError } from '../../utils/apiError.js';
import { generateTicketCode } from '../../utils/ids.js';
import { recordAudit } from '../audit/audit.service.js';
import { broadcastMovie, broadcastMovieRules, broadcastSeats } from '../../realtime/gateway.js';
import {
  AuditAction,
  BookingSource,
  MovieStatus,
  Rank,
  SeatStatus,
  TicketStatus,
  type BookingSourceType,
  type RankType,
} from '../../constants/enums.js';
import { Roles } from '../../types/index.js';
import { settings } from '../../config/settings.js';

const BOOKABLE = [MovieStatus.SCHEDULED, MovieStatus.OPEN];

// ---- Auditorium layout (admin) --------------------------------------------

export async function getAuditorium() {
  const existing = await AuditoriumModel.findOne();
  if (existing) return existing;
  return AuditoriumModel.create({ name: 'Main Auditorium', rows: [] });
}

interface LayoutRowInput {
  label: string;
  seats: { number: number; allowedRanks: string[] }[];
}

export async function saveAuditorium(input: { name?: string; rows: LayoutRowInput[] }) {
  const doc = await getAuditorium();
  if (input.name !== undefined) doc.name = input.name;
  doc.rows = input.rows as unknown as Auditorium['rows'];
  await doc.save();
  return doc;
}

// ---- Per-movie seat generation (admin) ------------------------------------

/**
 * (Re)generate a movie's seat inventory from the current auditorium layout. Refuses to wipe
 * seats once any are booked. Sets the movie's totalSeats to the layout size.
 */
export async function generateMovieSeats(movieId: string): Promise<number> {
  const movie = await MovieModel.findById(movieId);
  if (!movie) throw ApiError.notFound('Movie not found');

  const active = await MovieSeatModel.countDocuments({
    movie: movieId,
    status: { $in: [SeatStatus.BOOKED, SeatStatus.HELD] },
  });
  if (active > 0) throw ApiError.conflict('Seats are currently booked or on hold — cannot regenerate layout');

  const auditorium = await getAuditorium();
  const total = countSeats(auditorium.rows);
  if (total === 0) throw ApiError.badRequest('Design the auditorium layout first');

  await MovieSeatModel.deleteMany({ movie: movieId });
  const docs = auditorium.rows.flatMap((row) =>
    row.seats.map((seat) => ({
      movie: movie._id,
      row: row.label,
      number: seat.number,
      label: `${row.label}${seat.number}`,
      allowedRanks: seat.allowedRanks ?? [],
      status: SeatStatus.FREE,
    })),
  );
  if (docs.length > 0) await MovieSeatModel.insertMany(docs);

  movie.totalSeats = total;
  movie.seatsBooked = 0;
  await movie.save();
  return total;
}

/**
 * ADMIN: release a movie's seats to the general pool.
 *
 * **One-way.** Opening the pool dissolves unit quota immediately, and people then book seats
 * that no unit's allocation accounted for. Closing it again would snap those quotas back over
 * bookings they never counted — units would appear to have headroom they had already spent, and
 * the numbers would not add up for the rest of the show. There is no coherent way back, so the
 * server refuses rather than letting an admin discover that the hard way.
 *
 * When the pool is opened, we immediately compute the unused unit quota and credit it to
 * `poolSeats` and stamp `poolReleasedAt`. The movie keeps its current status (SCHEDULED/OPEN)
 * — the `openToAll` flag alone drives all pool behavior.
 */
export async function setMovieOpenToAll(movieId: string, open: boolean): Promise<boolean> {
  const movie = await MovieModel.findById(movieId);
  if (!movie) throw ApiError.notFound('Movie not found');
  if (movie.openToAll && !open) {
    throw ApiError.conflict('The pool cannot be closed once it has been opened');
  }
  if (movie.openToAll === open) return movie.openToAll; // already there — nothing to do
  movie.openToAll = open;

  // Immediately release the pool: compute unused quota and credit poolSeats now.
  if (open && !movie.poolReleasedAt) {
    const allocations = await SeatAllocationModel.find({ movie: movie._id });
    let unused = 0;
    for (const a of allocations) {
      const free = Math.max(0, a.allocated - a.booked);
      if (free > 0) {
        a.released += free;
        await a.save();
        unused += free;
      }
    }

    // A movie with no allocations has its whole inventory as common seats —
    // count the actually free seats so poolSeats isn't stuck at 0.
    if (allocations.length === 0) {
      unused = await MovieSeatModel.countDocuments({
        movie: movie._id,
        status: SeatStatus.FREE,
      });
    }

    movie.poolSeats += unused;
    movie.poolReleasedAt = new Date();
  }

  await movie.save();
  broadcastMovie(movie.id, {
    openToAll: movie.openToAll,
    poolSeats: movie.poolSeats,
  });
  // Anyone sitting on the seat map right now holds `bookable` flags computed under the old
  // rule — push the change so seats unlock (or re-lock) without a reload.
  broadcastMovieRules(movie.id, movie.openToAll);
  return movie.openToAll;
}

// ---- Seat map (user) ------------------------------------------------------

function rankAllowed(
  allowedRanks: readonly string[],
  rank: RankType | null,
  openToAll = false,
): boolean {
  if (!allowedRanks || allowedRanks.length === 0) return true; // seat has no rank restriction
  if (!rank) return false;
  if (allowedRanks.includes(rank)) return true; // user's own rank is allowed
  // When openToAll: JCOs may also book seats reserved for Jawans (one step down only).
  // No other cross-rank access is granted — Officers cannot book Jawan/JCO seats,
  // and Jawans cannot book JCO/Officer seats.
  if (openToAll && rank === Rank.JCO && allowedRanks.includes(Rank.JAWAN)) return true;
  return false;
}

export interface SeatView {
  label: string;
  row: string;
  number: number;
  status: 'FREE' | 'HELD' | 'BOOKED';
  allowedRanks: string[];
  bookable: boolean; // free AND the viewer's rank may book it
  mine: boolean; // held by the viewer
}

export async function getMovieSeatMap(
  movieId: string,
  userId?: string,
  rank: RankType | null = null,
): Promise<{
  rows: string[];
  seats: SeatView[];
  openToAll: boolean;
  /**
   * How long a hold lasts, from the live admin setting. Sent so the picker's countdown matches
   * the server instead of assuming 120s — an admin raising `seatHoldSeconds` used to leave the
   * client clearing the selection early, while lowering it left seats looking held after the
   * server had already freed them.
   */
  holdSeconds: number;
  /** Absent for an anonymous viewer — there is no personal limit to report. */
  allowance?: {
    familySize: number;
    booked: number;
    /** Seats they may actually pick: the lesser of family room and unit quota. */
    canSelect: number;
    /** Unit's remaining quota, or null when quota does not apply to this movie. */
    unitRemaining: number | null;
  };
}> {
  const movie = await MovieModel.findById(movieId).select('openToAll');
  const openToAll = Boolean(movie?.openToAll);
  const seats = await MovieSeatModel.find({ movie: movieId }).sort('row number');
  const rows = [...new Set(seats.map((s) => s.row))];
  const view: SeatView[] = seats.map((s) => {
    const isFree = s.status === SeatStatus.FREE;
    const mine = !!userId && String(s.heldBy) === userId && s.status === SeatStatus.HELD;
    return {
      label: s.label,
      row: s.row,
      number: s.number,
      status: s.status as SeatView['status'],
      allowedRanks: s.allowedRanks as string[],
      bookable: (isFree || mine) && rankAllowed(s.allowedRanks as string[], rank, openToAll),
      mine,
    };
  });
  // Ship the personal cap with the map so the picker can show "2/4 selected" and stop the
  // selection at the limit, instead of letting someone pick freely and fail on Confirm.
  let allowance:
    | { familySize: number; booked: number; canSelect: number; unitRemaining: number | null }
    | undefined;
  if (userId) {
    const user = await UserModel.findById(userId).select('familySize unit');
    if (user) {
      const a = await seatAllowance(
        userId,
        movieId,
        user.familySize,
        user.unit ? String(user.unit) : null,
      );
      // Seats they are already holding ARE the selection the picker is about to draw, so they
      // count as selectable — `a.remaining` has them subtracted, so add them back.
      const held = a.heldLabels.length;
      allowance = {
        familySize: a.familySize,
        booked: a.booked,
        canSelect: a.remaining + held,
        unitRemaining: a.unitRemaining === null ? null : a.unitRemaining + held,
      };
    }
  }

  return { rows, seats: view, openToAll, holdSeconds: settings().seatHoldSeconds, allowance };
}

// ---- Admin: full movie booking detail -------------------------------------

/**
 * ADMIN: the complete picture for one movie — the seat layout with, for every booked seat,
 * WHO booked it (mobile / rank / unit) and whether they've checked in, plus the list of
 * bookings. Powers the "Details" dialog in the admin Movies table.
 */
export async function getMovieAdminDetail(movieId: string) {
  const movie = await MovieModel.findById(movieId);
  if (!movie) throw ApiError.notFound('Movie not found');

  // Fetch seats, bookings, and per-unit allocations in parallel.
  const [seats, bookings, allocDocs] = await Promise.all([
    MovieSeatModel.find({ movie: movieId })
      .sort('row number')
      .populate({
        path: 'bookedBy',
        select: 'mobile rank unit',
        populate: { path: 'unit', select: 'name' },
      }),
    BookingModel.find({ movie: movieId })
      .populate('user', 'mobile rank')
      .populate('unit', 'name')
      .sort('-createdAt'),
    SeatAllocationModel.find({ movie: movieId })
      .populate('unit', 'name')
      .sort('unit'),
  ]);

  // ticketCode -> ticket status, so each seat can show checked-in / cancelled state.
  const ticketByCode = new Map<string, { status: string; checkedIn: boolean }>();
  for (const b of bookings) {
    for (const t of b.tickets) {
      if (t.code) ticketByCode.set(t.code, { status: t.status, checkedIn: t.checkedIn });
    }
  }

  const rows = [...new Set(seats.map((s) => s.row))];
  const seatViews = seats.map((s) => {
    const booker = s.bookedBy as unknown as
      | { mobile?: string; rank?: string; unit?: { name?: string } }
      | null;
    const t = s.ticketCode ? ticketByCode.get(s.ticketCode) : undefined;
    return {
      label: s.label,
      row: s.row,
      number: s.number,
      status: s.status as 'FREE' | 'HELD' | 'BOOKED',
      allowedRanks: s.allowedRanks as string[],
      ticketCode: s.ticketCode ?? null,
      checkedIn: t?.checkedIn ?? false,
      bookedBy: booker
        ? { mobile: booker.mobile ?? '', rank: booker.rank ?? null, unit: booker.unit?.name ?? null }
        : null,
    };
  });

  const bookingList = bookings.map((b) => {
    const u = b.user as unknown as { mobile?: string; rank?: string } | null;
    const unit = b.unit as unknown as { name?: string } | null;
    return {
      id: b.id,
      mobile: u?.mobile ?? '',
      rank: u?.rank ?? null,
      unit: unit?.name ?? null,
      cancelled: Boolean(b.cancelledAt),
      createdAt: (b as unknown as { createdAt: Date }).createdAt,
      tickets: b.tickets.map((t) => ({
        seatLabel: t.seatLabel ?? null,
        status: t.status,
        checkedIn: t.checkedIn,
      })),
    };
  });

  // Seats each unit's members ACTUALLY hold right now, counted from the bookings themselves.
  //
  // `SeatAllocation.booked` only moves on a unit-quota booking, so the moment the pool is opened
  // it freezes — and then keeps presenting itself as live quota while that unit's people carry on
  // booking from the pool. The counter would say "2 of 4, 2 remaining" while the unit in fact
  // held nine seats. Counting bookings instead means the figure can exceed `allocated`, which is
  // exactly what an open pool means and what the old display could never show.
  const activeByUnitAndRank = new Map<string, number>();
  for (const b of bookings) {
    const unitRef = b.unit as unknown as { _id?: unknown } | null;
    const unitId = unitRef ? String(unitRef._id ?? b.unit) : null;
    const userRef = b.user as unknown as { rank?: string } | null;
    const userRank = userRef?.rank;
    if (!unitId) continue; // no unit on the booking — nothing to attribute it to
    const active = b.tickets.filter(
      (t) => t.status === TicketStatus.BOOKED || t.status === TicketStatus.CHECKED_IN,
    ).length;
    if (active > 0) {
      const key = userRank ? `${unitId}:${userRank}` : unitId;
      activeByUnitAndRank.set(key, (activeByUnitAndRank.get(key) ?? 0) + active);
    }
  }

  const allocationList = allocDocs.map((a) => {
    const unitDoc = a.unit as unknown as { _id?: unknown; name?: string } | null;
    const unitId = String(unitDoc?._id ?? a.unit);
    const key = a.rank ? `${unitId}:${a.rank}` : unitId;
    const held = activeByUnitAndRank.get(key) ?? activeByUnitAndRank.get(unitId) ?? 0;
    activeByUnitAndRank.delete(key); // consumed; whatever is left booked without an allocation
    return {
      unit: unitDoc?.name ?? unitId,
      rank: a.rank ?? null,
      allocated: a.allocated,
      /** Live count — may exceed `allocated` once the pool is open. */
      booked: held,
      /** The quota counter, frozen at pool-open. Kept so the two can be told apart. */
      quotaUsed: Math.max(0, a.booked),
      released: a.released,
      remaining: Math.max(0, a.allocated - held),
      /** Seats beyond the unit's allocation, i.e. taken from the open pool. */
      overQuota: Math.max(0, held - a.allocated),
    };
  });

  // A unit/rank with no allocation can still book once the pool is open. Without a row of its own its
  // seats would simply not appear anywhere in this table.
  for (const [key, held] of activeByUnitAndRank) {
    const [unitId, rank] = key.includes(':') ? key.split(':') : [key, null];
    const named = bookings.find((b) => {
      const u = b.unit as unknown as { _id?: unknown; name?: string } | null;
      return u && String(u._id ?? b.unit) === unitId;
    });
    const u = named?.unit as unknown as { name?: string } | null;
    allocationList.push({
      unit: u?.name ?? unitId,
      rank,
      allocated: 0,
      booked: held,
      quotaUsed: 0,
      released: 0,
      remaining: 0,
      overQuota: held,
    });
  }

  return {
    movie: {
      id: movie.id,
      title: movie.title,
      startTime: movie.startTime,
      durationMinutes: movie.durationMinutes,
      endTime: movieEndTime(movie),
      status: movie.status,
      totalSeats: movie.totalSeats,
      seatsBooked: movie.seatsBooked,
      openToAll: movie.openToAll,
    },
    rows,
    seats: seatViews,
    bookings: bookingList,
    allocations: allocationList,
  };
}

// ---- Holds ----------------------------------------------------------------

async function assertBookableMovie(movieId: string) {
  const movie = await MovieModel.findById(movieId);
  if (!movie) throw ApiError.notFound('Movie not found');
  if (!BOOKABLE.includes(movie.status as (typeof BOOKABLE)[number])) {
    throw ApiError.conflict('Movie is not open for booking');
  }
  if (!isMovieVisible(movie)) {
    // Outside the window: either before booking opens, or after the show has ended.
    if (Date.now() >= movieEndTime(movie).getTime()) {
      throw ApiError.conflict('Booking is closed — the show has ended');
    }
    throw ApiError.forbidden('Booking has not opened yet');
  }
  return movie;
}

export interface SeatAllowance {
  /** Tickets this person may hold for one movie, themselves included. */
  familySize: number;
  /** Tickets already issued to them for this movie (BOOKED or CHECKED_IN). */
  booked: number;
  /** Seats they are holding right now — the live selection. */
  heldLabels: string[];
  /** How many more seats they may still take, family limit AND unit quota considered. */
  remaining: number;
  /**
   * Seats their unit has left, or `null` when the unit quota does not apply to this movie
   * (no allocations were made, or the pool has been released and quota is dissolved).
   */
  unitRemaining: number | null;
}

/**
 * What one person may still take for one movie — the single answer the picker's cap, the hold
 * check and the Confirm error all read, so they can never tell the user different numbers.
 *
 * TWO limits apply and the smaller wins:
 *  - their **family size**, minus tickets already issued and seats already held. Holds count as
 *    much as tickets: a hold is a seat nobody else can have, so ignoring them would let someone
 *    tie up the auditorium a hold at a time.
 *  - their **unit's remaining quota**, when the movie is on unit quota at all. A family of four
 *    facing a unit with one seat left can take exactly one — previously the cap said four, they
 *    held four, and Confirm then failed with "no remaining seats" while one was in fact free.
 *
 * `unitRemaining` is `null` when quota does not apply: no allocations were made for the movie
 * (everything sits in the common pool), or the pool has been released and quota is dissolved.
 */
export async function seatAllowance(
  userId: string,
  movieId: string,
  familySize: number,
  unitId?: string | null,
): Promise<SeatAllowance> {
  const [booked, heldSeats, movie, allocCount] = await Promise.all([
    heldTicketCount(userId, movieId),
    MovieSeatModel.find({ movie: movieId, heldBy: userId, status: SeatStatus.HELD }).select('label'),
    MovieModel.findById(movieId).select('status openToAll'),
    SeatAllocationModel.countDocuments({ movie: movieId }),
  ]);
  const heldLabels = heldSeats.map((s) => s.label);
  const familyRemaining = Math.max(0, familySize - booked - heldLabels.length);

  // Quota only bites while the movie is actually running on it. "Open to all" dissolves it
  // IMMEDIATELY — the whole point of the button is that anyone can book right away, so waiting
  // for the showtime pool release would leave units locked out for the hours in between.
  const quotaApplies =
    allocCount > 0 && !movie?.openToAll;
  let unitRemaining: number | null = null;
  if (quotaApplies) {
    if (!unitId) {
      // Allocations exist but this person has no unit — they have no quota to draw from.
      unitRemaining = 0;
    } else {
      const userDoc = await UserModel.findById(userId).select('rank');
      const userRankVal = userDoc?.rank ?? Rank.JAWAN;
      const alloc = await SeatAllocationModel.findOne({
        movie: movieId,
        unit: unitId,
        rank: userRankVal,
      }).select('allocated booked');
      const unitFree = alloc ? Math.max(0, alloc.allocated - alloc.booked) : 0;
      unitRemaining = Math.max(0, unitFree - heldLabels.length);
    }
  }

  return {
    familySize,
    booked,
    heldLabels,
    unitRemaining,
    remaining: unitRemaining === null ? familyRemaining : Math.min(familyRemaining, unitRemaining),
  };
}

async function userRank(userId: string): Promise<RankType | null> {
  const user = await UserModel.findById(userId).select('rank');
  return (user?.rank as RankType) ?? null;
}

/** Public helper for controllers to resolve a user's rank. */
export async function getUserRank(userId: string): Promise<RankType | null> {
  return userRank(userId);
}

/** Hold a set of seats for the user (atomic FREE -> HELD, with rank gate). */
export async function holdSeats(
  userId: string,
  movieId: string,
  labels: string[],
): Promise<{ held: string[] }> {
  const movie = await assertBookableMovie(movieId);
  const openToAll = Boolean(movie.openToAll);
  // `unit` matters as much as `familySize` here — omitting it made the quota check believe the
  // user had no unit, which reads as "no quota at all" and refused every hold.
  const user = await UserModel.findById(userId).select('rank familySize unit');
  if (!user) throw ApiError.unauthorized();
  const rank = (user.rank as RankType) ?? null;

  // Enforce BOTH limits at HOLD time, not just at book time. Holding was previously unlimited:
  // a user could tie up any number of seats for the hold window — seats their unit did not even
  // have — and only discover the cap when they pressed Confirm.
  const allowance = await seatAllowance(
    userId,
    movieId,
    user.familySize,
    user.unit ? String(user.unit) : null,
  );
  const mineAlready = new Set(allowance.heldLabels);
  const wanted = labels.filter((l) => !mineAlready.has(l)).length;
  if (wanted > allowance.remaining) {
    // Say the number they may hold IN TOTAL, not the number still free — otherwise someone
    // holding their unit's last seat is told "no seats left for your unit", which is both
    // confusing and useless. "No seats left" is reserved for the case where they hold none.
    const held = allowance.heldLabels.length;
    const total = allowance.remaining + held;
    const familyRoom = Math.max(0, user.familySize - allowance.booked);
    const unitIsTheLimit = allowance.unitRemaining !== null && total < familyRoom;
    const message =
      total === 0
        ? 'No seats left for your unit for this movie'
        : unitIsTheLimit
          ? `Your unit allows ${total} seat(s) for this show`
          : `You may book at most ${familyRoom} seat(s) for this movie`;
    throw ApiError.badRequest(message, {
      familySize: user.familySize,
      booked: allowance.booked,
      remaining: allowance.remaining,
      unitRemaining: allowance.unitRemaining,
    });
  }

  const expires = new Date(Date.now() + settings().seatHoldSeconds * 1_000);
  const held: string[] = [];

  for (const label of labels) {
    const seat = await MovieSeatModel.findOne({ movie: movieId, label });
    if (!seat) throw ApiError.badRequest(`Unknown seat ${label}`);
    if (!rankAllowed(seat.allowedRanks as string[], rank, openToAll)) {
      // roll back what we held so far
      await releaseSeats(userId, movieId, held);
      throw ApiError.forbidden(`Your rank cannot book seat ${label}`);
    }
    // Atomic: only succeeds if the seat is FREE, or already held by this user (re-hold).
    const updated = await MovieSeatModel.findOneAndUpdate(
      {
        movie: movieId,
        label,
        $or: [
          { status: SeatStatus.FREE },
          { status: SeatStatus.HELD, heldBy: userId },
        ],
      },
      { $set: { status: SeatStatus.HELD, heldBy: userId, holdExpiresAt: expires } },
      { new: true },
    );
    if (!updated) {
      await releaseSeats(userId, movieId, held);
      throw ApiError.conflict(`Seat ${label} is no longer available`);
    }
    held.push(label);
  }

  broadcastSeats(movieId, held.map((label) => ({ label, status: 'HELD' })));
  return { held };
}

/** Release seats the user is holding (HELD by them -> FREE). */
export async function releaseSeats(
  userId: string,
  movieId: string,
  labels: string[],
): Promise<void> {
  if (labels.length === 0) return;
  await MovieSeatModel.updateMany(
    { movie: movieId, label: { $in: labels }, status: SeatStatus.HELD, heldBy: userId },
    { $set: { status: SeatStatus.FREE, heldBy: null, holdExpiresAt: null } },
  );
  broadcastSeats(movieId, labels.map((label) => ({ label, status: 'FREE' })));
}

// ---- Booking from seats ---------------------------------------------------

async function heldTicketCount(userId: string, movieId: string): Promise<number> {
  const rows = await BookingModel.aggregate<{ n: number }>([
    { $match: { user: new Types.ObjectId(userId), movie: new Types.ObjectId(movieId) } },
    { $unwind: '$tickets' },
    { $match: { 'tickets.status': { $in: [TicketStatus.BOOKED, TicketStatus.CHECKED_IN] } } },
    { $count: 'n' },
  ]);
  return rows[0]?.n ?? 0;
}

/**
 * Book the given seats. Each seat is claimed via an atomic FREE/own-HELD -> BOOKED update;
 * any failure rolls back already-claimed seats. Produces a Booking with one QR ticket per
 * seat. Idempotent on (user, idempotencyKey).
 */
export async function bookSeats(args: {
  userId: string;
  movieId: string;
  labels: string[];
  idempotencyKey: string;
  req?: Request;
}): Promise<MovieSeatDoc[] & { bookingId?: string }> {
  const { userId, movieId, labels, idempotencyKey, req } = args;

  const prior = await BookingModel.findOne({ user: userId, idempotencyKey });
  if (prior) {
    const seats = await MovieSeatModel.find({ movie: movieId, booking: prior._id });
    return Object.assign(seats, { bookingId: prior.id });
  }

  const movie = await assertBookableMovie(movieId);
  const user = await UserModel.findById(userId);
  if (!user) throw ApiError.unauthorized();

  // Family limit.
  const held = await heldTicketCount(userId, movieId);
  if (held + labels.length > user.familySize) {
    throw ApiError.badRequest(
      `Family limit exceeded: you may hold at most ${user.familySize} tickets for this movie`,
    );
  }

  const openToAll = Boolean(movie.openToAll);
  const rank = (user.rank as RankType) ?? null;
  const claimed: string[] = [];
  const tickets: { code: string; seatLabel: string; status: string }[] = [];

  for (const label of labels) {
    const seat = await MovieSeatModel.findOne({ movie: movieId, label });
    if (!seat) {
      await rollback(userId, movieId, claimed);
      throw ApiError.badRequest(`Unknown seat ${label}`);
    }
    if (!rankAllowed(seat.allowedRanks as string[], rank, openToAll)) {
      await rollback(userId, movieId, claimed);
      throw ApiError.forbidden(`Your rank cannot book seat ${label}`);
    }
    const code = generateTicketCode();
    const updated = await MovieSeatModel.findOneAndUpdate(
      {
        movie: movieId,
        label,
        $or: [
          { status: SeatStatus.FREE },
          { status: SeatStatus.HELD, heldBy: userId },
        ],
      },
      {
        $set: {
          status: SeatStatus.BOOKED,
          heldBy: null,
          holdExpiresAt: null,
          bookedBy: userId,
          ticketCode: code,
        },
      },
      { new: true },
    );
    if (!updated) {
      await rollback(userId, movieId, claimed);
      throw ApiError.conflict(`Seat ${label} is no longer available`);
    }
    claimed.push(label);
    tickets.push({ code, seatLabel: label, status: TicketStatus.BOOKED });
  }

  // Check if per-unit seat allocations exist for this movie.
  const allocCount = await SeatAllocationModel.countDocuments({ movie: movie._id });
  const hasAllocations = allocCount > 0;
  // "Open to all" counts as pooled from the instant it is set, even before the showtime
  // release — otherwise the button would lift rank gating immediately but leave unit quota
  // biting until the show started, which is not what "open to all" means to anyone.
  const pooled = Boolean(movie.openToAll);
  const unitId = user.unit ? String(user.unit) : null;

  const source: BookingSourceType = pooled
    ? BookingSource.OPEN_POOL
    : hasAllocations
      ? BookingSource.UNIT_QUOTA
      : BookingSource.OPEN_POOL;

  // What THIS attempt actually consumed. The rollback must give back exactly this and no more:
  // decrementing the unit quota unconditionally handed back a seat that a *different*,
  // successful booking was holding, which let a second person book against a 1-seat allocation.
  let quotaTaken = 0;
  let quotaRank: RankType | null = null;
  let poolTaken = 0;

  let bookingId: string;
  try {
    if (source === BookingSource.UNIT_QUOTA) {
      if (!unitId) {
        await rollback(userId, movieId, claimed);
        throw ApiError.badRequest('User is not assigned to a unit');
      }
      const userDoc = await UserModel.findById(userId).select('rank');
      const userRankVal = userDoc?.rank ?? Rank.JAWAN;

      const alloc = await SeatAllocationModel.findOneAndUpdate(
        {
          movie: movie._id,
          unit: unitId,
          rank: userRankVal,
          $expr: { $gte: [{ $subtract: ['$allocated', '$booked'] }, labels.length] },
        },
        { $inc: { booked: labels.length } },
        { new: true },
      );
      if (!alloc) {
        await rollback(userId, movieId, claimed);
        const current = await SeatAllocationModel.findOne({
          movie: movie._id,
          unit: unitId,
          rank: userRankVal,
        }).select('allocated booked');
        const left = current ? Math.max(0, current.allocated - current.booked) : 0;
        throw ApiError.conflict(
          left === 0
            ? `No ${userRankVal} seats left for your unit for this movie`
            : `Your unit has only ${left} ${userRankVal} seat(s) left for this movie`,
          { unitRemaining: left, requested: labels.length, rank: userRankVal },
        );
      }
      quotaTaken = labels.length;
      quotaRank = userRankVal;
    } else if (pooled) {
      // `poolSeats` is a COUNTER, not the inventory. The seats themselves were already claimed
      // atomically above (FREE -> BOOKED), which is what actually prevents overselling, so
      // gating on the counter too added no safety and plenty of failure: a counter that had
      // drifted low — or was never credited, as on a movie whose allocation was skipped —
      // refused bookings for seats that were plainly free. It is now decremented for reporting
      // and floored at zero, and never blocks.
      const m = await MovieModel.findOneAndUpdate(
        { _id: movie._id, $expr: { $gte: ['$poolSeats', labels.length] } },
        { $inc: { poolSeats: -labels.length } },
        { new: true },
      );
      // Only what was actually decremented may be refunded on failure — `m` is null when the
      // counter was too low to take from, and claiming otherwise would credit back seats this
      // attempt never took.
      poolTaken = m ? labels.length : 0;
    }

    const [booking] = await BookingModel.create([
      {
        user: userId,
        movie: movie._id,
        unit: user.unit ?? null,
        source,
        quantity: labels.length,
        idempotencyKey,
        tickets,
      },
    ]);
    bookingId = booking!.id;
    await MovieSeatModel.updateMany(
      { movie: movieId, label: { $in: claimed } },
      { $set: { booking: booking!._id } },
    );
    const after = await MovieModel.findOneAndUpdate(
      { _id: movie._id },
      { $inc: { seatsBooked: claimed.length } },
      { new: true, projection: 'seatsBooked' },
    );
    // The first booking is what permanently removes the admin's delete button, so the console
    // needs to see this without a reload.
    if (after) broadcastMovie(movie.id, { seatsBooked: after.seatsBooked });
  } catch (err) {
    await rollback(userId, movieId, claimed, { unitId, rank: quotaRank, quotaTaken, poolTaken });
    if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
      const existing = await BookingModel.findOne({ user: userId, idempotencyKey });
      if (existing) {
        const seats = await MovieSeatModel.find({ movie: movieId, booking: existing._id });
        return Object.assign(seats, { bookingId: existing.id });
      }
    }
    throw err;
  }

  await recordAudit({
    action: AuditAction.BOOKING_CREATE,
    user: userId,
    role: Roles.USER,
    req,
    metadata: { bookingId, movieId, seats: claimed },
  });
  broadcastSeats(movieId, claimed.map((label) => ({ label, status: 'BOOKED' })));

  const seats = await MovieSeatModel.find({ movie: movieId, label: { $in: claimed } });
  return Object.assign(seats, { bookingId });
}

/**
 * Undo a partial booking.
 *
 * `taken` is what THIS attempt actually consumed, not what it intended to. The counters are
 * shared across users, so refunding on intent is a correctness bug in both directions:
 *  - the unit quota used to be decremented whenever the source was UNIT_QUOTA, including when
 *    the atomic guard had *rejected* the booking and never incremented anything — so a failed
 *    attempt handed back the seat a different, successful booking was holding, and a retry then
 *    sailed through. Two people ended up booked against a one-seat allocation.
 *  - the common pool was never refunded at all, so a booking that failed after claiming pool
 *    seats leaked them permanently.
 */
async function rollback(
  userId: string,
  movieId: string,
  labels: string[],
  taken?: {
    unitId?: string | null;
    /** The rank row the quota was taken from. Allocations are per (movie, unit, rank), so a
     *  refund without it decrements whichever row Mongo happens to match first — handing back
     *  an Officer seat for a JCO's failed booking, and leaving the JCO's own seat consumed. */
    rank?: RankType | null;
    quotaTaken?: number;
    poolTaken?: number;
  },
): Promise<void> {
  if (labels.length > 0) {
    await MovieSeatModel.updateMany(
      { movie: movieId, label: { $in: labels }, bookedBy: userId, status: SeatStatus.BOOKED },
      { $set: { status: SeatStatus.FREE, bookedBy: null, ticketCode: null, booking: null } },
    );
  }
  const quota = taken?.quotaTaken ?? 0;
  if (quota > 0 && taken?.unitId && taken.rank) {
    await SeatAllocationModel.updateOne(
      { movie: movieId, unit: taken.unitId, rank: taken.rank, booked: { $gte: quota } },
      { $inc: { booked: -quota } },
    );
  }
  const pool = taken?.poolTaken ?? 0;
  if (pool > 0) {
    await MovieModel.updateOne({ _id: movieId }, { $inc: { poolSeats: pool } });
  }
}

// ---- Hold expiry job ------------------------------------------------------

/** Reclaim seats whose hold has elapsed (FREE again). Returns count reclaimed. */
export async function releaseExpiredHolds(now: Date = new Date()): Promise<number> {
  const expired = await MovieSeatModel.find({
    status: SeatStatus.HELD,
    holdExpiresAt: { $lte: now },
  }).select('movie label');
  if (expired.length === 0) return 0;

  await MovieSeatModel.updateMany(
    { status: SeatStatus.HELD, holdExpiresAt: { $lte: now } },
    { $set: { status: SeatStatus.FREE, heldBy: null, holdExpiresAt: null } },
  );

  // Broadcast per movie.
  const byMovie = new Map<string, string[]>();
  for (const s of expired) {
    const key = String(s.movie);
    if (!byMovie.has(key)) byMovie.set(key, []);
    byMovie.get(key)!.push(s.label);
  }
  for (const [movieId, labels] of byMovie) {
    broadcastSeats(movieId, labels.map((label) => ({ label, status: 'FREE' })));
  }
  return expired.length;
}
