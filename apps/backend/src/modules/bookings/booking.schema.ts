import { z } from 'zod';

export const createBookingSchema = z.object({
  movieId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid movie id'),
  quantity: z.number().int().min(1).max(20),
  // Client-supplied idempotency key — makes retries safe (no double-booking).
  idempotencyKey: z.string().trim().min(8).max(100),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const idParamSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id'),
});
