import { z } from 'zod';

/**
 * Bounds mirror the model's, so an out-of-range value is rejected with a readable 400 before
 * it ever reaches Mongo. At least one field must be present — an empty PATCH is a client bug.
 */
export const updateSettingsSchema = z
  .object({
    visibilityLeadMinutes: z.coerce.number().int().min(1).max(20_160).optional(),
    noShowGraceMinutes: z.coerce.number().int().min(1).max(1_440).optional(),
    seatHoldSeconds: z.coerce.number().int().min(15).max(3_600).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No settings provided' });

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
