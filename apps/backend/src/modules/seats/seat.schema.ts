import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const movieIdParamSchema = z.object({ movieId: objectId });

/**
 * Replace the full set of per-unit allocations for a movie. Provided as a complete set so
 * the sum == totalSeats invariant can be validated atomically. Units must be unique.
 */
export const setAllocationsSchema = z.object({
  allocations: z
    .array(
      z.object({
        unit: objectId,
        allocated: z.number().int().min(0).max(100000),
      }),
    )
    .min(1)
    .superRefine((rows, ctx) => {
      const seen = new Set<string>();
      for (const r of rows) {
        if (seen.has(r.unit)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate unit ${r.unit}` });
        }
        seen.add(r.unit);
      }
    }),
});
export type SetAllocationsInput = z.infer<typeof setAllocationsSchema>;
