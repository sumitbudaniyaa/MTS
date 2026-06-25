import type { FilterQuery } from 'mongoose';
import {
  AuditoriumModel,
  MovieModel,
  countSeats,
  isMovieVisible,
  type MovieDoc,
} from '../../models/index.js';
import { ApiError } from '../../utils/apiError.js';
import { buildMeta, type Paginated } from '../../utils/pagination.js';
import { env } from '../../config/env.js';
import { MovieStatus } from '../../constants/enums.js';
import type { CreateMovieInput, MovieListQuery, UpdateMovieInput } from './movie.schema.js';

export async function createMovie(input: CreateMovieInput): Promise<MovieDoc> {
  // Total seats are the auditorium's capacity (single source of truth). Fall back to an
  // explicit value only when no auditorium has been designed yet.
  const auditorium = await AuditoriumModel.findOne();
  const layoutSeats = auditorium ? countSeats(auditorium.rows) : 0;
  const totalSeats = layoutSeats > 0 ? layoutSeats : (input.totalSeats ?? 0);
  if (totalSeats === 0) {
    throw ApiError.badRequest('Design the auditorium layout before creating a movie');
  }

  const movie = await MovieModel.create({
    title: input.title,
    description: input.description ?? '',
    poster: input.poster ?? '',
    // Single datetime in the UI — derive the show date from startTime when not supplied.
    showDate: input.showDate ?? input.startTime,
    startTime: input.startTime,
    totalSeats,
    status: input.status,
  });

  // Auto-build the bookable seat map from the auditorium layout (when one exists), so the
  // movie is immediately bookable — no separate "generate seats" step.
  if (layoutSeats > 0) {
    try {
      const { generateMovieSeats } = await import('../seating/seating.service.js');
      await generateMovieSeats(movie.id);
    } catch (err) {
      await MovieModel.findByIdAndDelete(movie.id);
      throw err;
    }
  }
  return movie;
}

export async function listMovies(query: MovieListQuery): Promise<Paginated<MovieDoc>> {
  const filter: FilterQuery<MovieDoc> = {};
  if (query.status) filter.status = query.status;
  if (query.search) filter.title = { $regex: query.search, $options: 'i' };

  const [items, total] = await Promise.all([
    MovieModel.find(filter)
      .sort(query.sort ?? '-startTime')
      .skip((query.page - 1) * query.limit)
      .limit(query.limit),
    MovieModel.countDocuments(filter),
  ]);
  return { items, ...buildMeta(total, query.page, query.limit) };
}

export async function getMovie(id: string): Promise<MovieDoc> {
  const movie = await MovieModel.findById(id);
  if (!movie) throw ApiError.notFound('Movie not found');
  return movie;
}

/** Booking opens at startTime - VISIBILITY_LEAD; after that a movie is locked for edits. */
function bookingHasOpened(movie: MovieDoc, now: Date = new Date()): boolean {
  const lead = env.VISIBILITY_LEAD_MINUTES * 60_000;
  return now.getTime() >= movie.startTime.getTime() - lead;
}

export async function updateMovie(id: string, input: UpdateMovieInput): Promise<MovieDoc> {
  const movie = await getMovie(id);
  // Once the booking window has opened, details are frozen so users aren't misled mid-sale.
  if (bookingHasOpened(movie)) {
    throw ApiError.conflict('Cannot edit a movie after its booking window has opened');
  }
  // Total seats are immutable once allocations exist; not exposed in update schema.
  Object.assign(movie, input);
  await movie.save();
  return movie;
}

export async function deleteMovie(id: string): Promise<void> {
  const movie = await getMovie(id);
  if (bookingHasOpened(movie)) {
    throw ApiError.conflict('Cannot delete a movie after its booking window has opened');
  }
  const res = await MovieModel.findByIdAndDelete(id);
  if (!res) throw ApiError.notFound('Movie not found');
}

/**
 * USER-facing list: upcoming/ongoing bookable movies. Movies are shown to users early (any
 * scheduled future show), but **booking only opens `VISIBILITY_LEAD` minutes before start**
 * (see `toPublicMovie.bookingOpen` and the seat-booking gate). Internal fields are never
 * included.
 */
export async function listVisibleMovies(now: Date = new Date()): Promise<MovieDoc[]> {
  const grace = env.NO_SHOW_GRACE_MINUTES * 60_000;
  // Still relevant until startTime + grace; otherwise show everything upcoming.
  const stillOpenAfter = new Date(now.getTime() - grace);

  return MovieModel.find({
    status: { $in: [MovieStatus.SCHEDULED, MovieStatus.OPEN, MovieStatus.POOL_RELEASED] },
    startTime: { $gte: stillOpenAfter },
  }).sort('startTime');
}

/**
 * SCANNER-facing list: movies relevant for door verification — anything scheduled/open
 * today onward. Returns minimal display fields plus live booked/total counts.
 */
export async function listScannerMovies(now: Date = new Date()): Promise<
  Array<{
    id: string;
    title: string;
    poster: string;
    startTime: Date;
    status: string;
    seatsBooked: number;
    totalSeats: number;
  }>
> {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000);
  const movies = await MovieModel.find({
    status: { $in: [MovieStatus.SCHEDULED, MovieStatus.OPEN, MovieStatus.POOL_RELEASED] },
    startTime: { $gte: dayAgo },
  }).sort('startTime');
  return movies.map((m) => ({
    id: m.id,
    title: m.title,
    poster: m.poster,
    startTime: m.startTime,
    status: m.status,
    seatsBooked: m.seatsBooked,
    totalSeats: m.totalSeats,
  }));
}

/** Public projection for USER apps — hides internal seat economy. */
export function toPublicMovie(movie: MovieDoc) {
  const availableSeats = Math.max(0, movie.totalSeats - movie.seatsBooked);
  return {
    id: movie.id,
    title: movie.title,
    description: movie.description,
    poster: movie.poster,
    showDate: movie.showDate,
    startTime: movie.startTime,
    availableSeats,
    soldOut: availableSeats <= 0,
    // Booking only opens VISIBILITY_LEAD minutes before showtime.
    bookingOpen: isMovieVisible(movie),
  };
}
