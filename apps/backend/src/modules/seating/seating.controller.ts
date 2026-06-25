import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/apiError.js';
import type { RankType } from '../../constants/enums.js';
import * as svc from './seating.service.js';
import type { BookSeatsInput, SaveAuditoriumInput } from './seating.schema.js';

// ---- Auditorium layout (ADMIN) ----
export const getAuditorium = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ auditorium: await svc.getAuditorium() });
});

export const saveAuditorium = asyncHandler(async (req: Request, res: Response) => {
  const auditorium = await svc.saveAuditorium(req.body as SaveAuditoriumInput);
  res.json({ auditorium });
});

export const generateSeats = asyncHandler(async (req: Request, res: Response) => {
  const total = await svc.generateMovieSeats(req.params.movieId as string);
  res.json({ total });
});

export const setOpenToAll = asyncHandler(async (req: Request, res: Response) => {
  const open = Boolean((req.body as { open?: boolean }).open);
  const result = await svc.setMovieOpenToAll(req.params.movieId as string, open);
  res.json({ openToAll: result });
});

// ---- Seat map (USER) ----
export const getSeatMap = asyncHandler(async (req: Request, res: Response) => {
  const movieId = req.params.movieId as string;
  // Admin may inspect without a rank; users see bookability for their own rank.
  const userId = req.principal?.sub;
  const rank = (req.principal?.role === 'USER' ? await svc.getUserRank(userId!) : null) as RankType | null;
  res.json(await svc.getMovieSeatMap(movieId, userId, rank));
});

export const holdSeats = asyncHandler(async (req: Request, res: Response) => {
  if (!req.principal) throw ApiError.unauthorized();
  const { labels } = req.body as { labels: string[] };
  res.json(await svc.holdSeats(req.principal.sub, req.params.movieId as string, labels));
});

export const releaseSeats = asyncHandler(async (req: Request, res: Response) => {
  if (!req.principal) throw ApiError.unauthorized();
  const { labels } = req.body as { labels: string[] };
  await svc.releaseSeats(req.principal.sub, req.params.movieId as string, labels);
  res.json({ success: true });
});

export const bookSeats = asyncHandler(async (req: Request, res: Response) => {
  if (!req.principal) throw ApiError.unauthorized();
  const body = req.body as BookSeatsInput;
  const seats = await svc.bookSeats({
    userId: req.principal.sub,
    movieId: req.params.movieId as string,
    labels: body.labels,
    idempotencyKey: body.idempotencyKey,
    req,
  });
  res.status(201).json({ bookingId: (seats as { bookingId?: string }).bookingId, seats: seats.length });
});
