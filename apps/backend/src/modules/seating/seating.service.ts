import type { Request } from 'express';
import { Types } from 'mongoose';
import {
  AuditoriumModel,
  BookingModel,
  MovieModel,
  MovieSeatModel,
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
import { broadcastSeats } from '../../realtime/gateway.js';
import { AuditAction, MovieStatus, SeatStatus, TicketStatus, type RankType } from '../../constants/enums.js';
import { Roles } from '../../types/index.js';
import { env } from '../../config/env.js';

const HOLD_MS = 2 * 60_000; // seats held for 2 minutes while booking
const BOOKABLE = [MovieStatus.SCHEDULED, MovieStatus.OPEN, MovieStatus.POOL_RELEASED];

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

  const booked = await MovieSeatModel.countDocuments({ movie: movieId, status: SeatStatus.BOOKED });
  if (booked > 0) throw ApiError.conflict('Seats already booked — cannot regenerate layout');

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

/** ADMIN: open a movie's booking to ALL ranks (free-for-all), or restore rank gating. */
export async function setMovieOpenToAll(movieId: string, open: boolean): Promise<boolean> {
  const movie = await MovieModel.findById(movieId);
  if (!movie) throw ApiError.notFound('Movie not found');
  movie.openToAll = open;
  await movie.save();
  return movie.openToAll;
}

// ---- Seat map (user) ------------------------------------------------------

function rankAllowed(
  allowedRanks: readonly string[],
  rank: RankType | null,
  openToAll = false,
): boolean {
  if (openToAll) return true; // admin opened the movie to every rank
  if (!allowedRanks || allowedRanks.length === 0) return true; // seat open to all
  return rank ? allowedRanks.includes(rank) : false;
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
): Promise<{ rows: string[]; seats: SeatView[]; openToAll: boolean }> {
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
  return { rows, seats: view, openToAll };
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

async function userRank(userId: string): Promise<RankType | null> {
  const user = await UserModel.findById(userId).select('rank');
  return (user?.rank as RankType) ?? null;
}

/** Public helper for controllers to resolve a user's rank. */
export async function getUserRank(userId: string): Promise<RankType | null> {
  return userRank(userId);
}

/** Hold a set of seats for the user for 2 minutes (atomic FREE -> HELD, with rank gate). */
export async function holdSeats(
  userId: string,
  movieId: string,
  labels: string[],
): Promise<{ held: string[] }> {
  const movie = await assertBookableMovie(movieId);
  const openToAll = Boolean(movie.openToAll);
  const rank = await userRank(userId);
  const expires = new Date(Date.now() + HOLD_MS);
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

  let bookingId: string;
  try {
    const [booking] = await BookingModel.create([
      {
        user: userId,
        movie: movie._id,
        unit: user.unit ?? null,
        source: 'UNIT_QUOTA',
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
    await MovieModel.updateOne({ _id: movie._id }, { $inc: { seatsBooked: claimed.length } });
  } catch (err) {
    await rollback(userId, movieId, claimed);
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

async function rollback(userId: string, movieId: string, labels: string[]): Promise<void> {
  if (labels.length === 0) return;
  await MovieSeatModel.updateMany(
    { movie: movieId, label: { $in: labels }, bookedBy: userId, status: SeatStatus.BOOKED },
    { $set: { status: SeatStatus.FREE, bookedBy: null, ticketCode: null, booking: null } },
  );
}

// ---- Hold expiry job ------------------------------------------------------

/** Reclaim seats whose 2-minute hold has elapsed (FREE again). Returns count reclaimed. */
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

void env; // (reserved for future hold-duration config)
