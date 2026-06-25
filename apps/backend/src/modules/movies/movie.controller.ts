import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { AuditAction } from '../../constants/enums.js';
import { recordAudit } from '../audit/audit.service.js';
import * as svc from './movie.service.js';
import { movieListQuerySchema } from './movie.schema.js';
import type { CreateMovieInput, UpdateMovieInput } from './movie.schema.js';

// ---- ADMIN ----
export const createMovie = asyncHandler(async (req: Request, res: Response) => {
  const movie = await svc.createMovie(req.body as CreateMovieInput);
  await recordAudit({ action: AuditAction.MOVIE_CREATE, req, metadata: { movieId: movie.id } });
  res.status(201).json({ movie });
});

export const listMovies = asyncHandler(async (req: Request, res: Response) => {
  const query = movieListQuerySchema.parse(req.query);
  res.json(await svc.listMovies(query));
});

export const getMovie = asyncHandler(async (req: Request, res: Response) => {
  res.json({ movie: await svc.getMovie(req.params.id as string) });
});

export const updateMovie = asyncHandler(async (req: Request, res: Response) => {
  const movie = await svc.updateMovie(req.params.id as string, req.body as UpdateMovieInput);
  res.json({ movie });
});

export const deleteMovie = asyncHandler(async (req: Request, res: Response) => {
  await svc.deleteMovie(req.params.id as string);
  res.json({ success: true });
});

// ---- USER ----
export const listAvailableMovies = asyncHandler(async (_req: Request, res: Response) => {
  const movies = await svc.listVisibleMovies();
  res.json({ items: movies.map(svc.toPublicMovie) });
});

// ---- SCANNER ----
export const listScannerMovies = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ items: await svc.listScannerMovies() });
});
