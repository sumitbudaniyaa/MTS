import { z } from 'zod';
import { Rank } from '../../constants/enums.js';

const rankArray = z.array(z.nativeEnum(Rank)).default([]);

export const saveAuditoriumSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  rows: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(8),
        seats: z
          .array(
            z.object({
              number: z.number().int().min(1).max(1000),
              allowedRanks: rankArray,
            }),
          )
          .max(1000),
      }),
    )
    .max(100),
});
export type SaveAuditoriumInput = z.infer<typeof saveAuditoriumSchema>;

export const movieIdParamSchema = z.object({
  movieId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid movie id'),
});

const seatLabels = z.object({
  labels: z.array(z.string().trim().min(1).max(12)).min(1).max(20),
});
export const holdSchema = seatLabels;
export const releaseSchema = seatLabels;

export const bookSeatsSchema = z.object({
  labels: z.array(z.string().trim().min(1).max(12)).min(1).max(20),
  idempotencyKey: z.string().trim().min(8).max(100),
});
export type BookSeatsInput = z.infer<typeof bookSeatsSchema>;
