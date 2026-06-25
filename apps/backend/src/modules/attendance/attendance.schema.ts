import { z } from 'zod';

export const verifySchema = z.object({
  code: z.string().trim().min(4).max(40),
});
export type VerifyInput = z.infer<typeof verifySchema>;

export const movieIdParamSchema = z.object({
  movieId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id'),
});
