import { z } from 'zod';
import { MovieStatus } from '../../constants/enums.js';

/** Poster may be an http(s) URL or an uploaded image as a base64 data URL (capped ~4MB). */
const posterSchema = z
  .string()
  .trim()
  .max(6_000_000)
  .refine(
    (s) =>
      s === '' ||
      /^https?:\/\//i.test(s) ||
      /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(s),
    'Poster must be an image URL or an uploaded image',
  )
  .optional()
  .or(z.literal(''));

/** Optional per-unit allocation set provided inline when hosting a movie. */
const allocationsSchema = z
  .array(
    z.object({
      unit: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid unit id'),
      allocated: z.number().int().min(0).max(100000),
    }),
  )
  .optional();

export const createMovieSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).optional(),
    poster: posterSchema,
    // Optional — defaults to the date part of startTime (single datetime in the UI).
    showDate: z.coerce.date().optional(),
    startTime: z.coerce.date(),
    // Show length in minutes (booking stays open until startTime + duration).
    durationMinutes: z.number().int().min(1).max(1440).optional(),
    // Derived from the auditorium layout server-side; not required from the client.
    totalSeats: z.number().int().min(1).max(100000).optional(),
    status: z.enum([MovieStatus.DRAFT, MovieStatus.SCHEDULED]).default(MovieStatus.DRAFT),
    allocations: allocationsSchema,
  })
  .refine((d) => d.startTime.getTime() > Date.now(), {
    message: 'startTime must be in the future',
    path: ['startTime'],
  });
export type CreateMovieInput = z.infer<typeof createMovieSchema>;

export const updateMovieSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(2000).optional(),
  poster: posterSchema,
  showDate: z.coerce.date().optional(),
  startTime: z.coerce.date().optional(),
  durationMinutes: z.number().int().min(1).max(1440).optional(),
  status: z
    .enum([MovieStatus.DRAFT, MovieStatus.SCHEDULED, MovieStatus.CLOSED, MovieStatus.CANCELLED])
    .optional(),
});
export type UpdateMovieInput = z.infer<typeof updateMovieSchema>;

export const idParamSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id'),
});

export const movieListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  status: z.nativeEnum(MovieStatus).optional(),
  sort: z.string().trim().max(50).optional(),
});
export type MovieListQuery = z.infer<typeof movieListQuerySchema>;
