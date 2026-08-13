import { z } from 'zod';
import { Rank } from '../../constants/enums.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const movieIdParamSchema = z.object({ movieId: objectId });

/**
 * Replace the full set of per-unit, per-rank allocations for a movie.
 * Provided as a complete set so the sum == totalSeats invariant can be validated atomically.
 */
export const setAllocationsSchema = z.object({
  allocations: z
    .array(
      z.object({
        unit: objectId,
        rank: z.nativeEnum(Rank),
        allocated: z.number().int().min(0).max(100000),
      }),
    )
    .min(1)
    .superRefine((rows, ctx) => {
      const seen = new Set<string>();
      for (const r of rows) {
        const key = `${r.unit}:${r.rank}`;
        if (seen.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate allocation for unit ${r.unit} and rank ${r.rank}`,
          });
        }
        seen.add(key);
      }
    }),
});
export type SetAllocationsInput = z.infer<typeof setAllocationsSchema>;
