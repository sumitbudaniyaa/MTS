import { z } from 'zod';

export const createUnitSchema = z.object({
  name: z.string().trim().min(2).max(80),
  loginMode: z.enum(['MOBILE', 'USERNAME']).optional(),
});
export type CreateUnitInput = z.infer<typeof createUnitSchema>;

export const updateUnitSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  loginMode: z.enum(['MOBILE', 'USERNAME']).optional(),
  active: z.boolean().optional(),
});
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;

export const idParamSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id'),
});
