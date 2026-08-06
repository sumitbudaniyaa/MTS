import { z } from 'zod';
import { MaritalStatus, Rank } from '../../constants/enums.js';
import { Roles } from '../../types/index.js';

const mobile = z.string().regex(/^\d{10}$/, 'Mobile must be 10 digits');

/**
 * Note: `familySize` is intentionally NOT accepted from the client — it is always derived
 * server-side from maritalStatus + numberOfKids. spouseMobile only allowed when MARRIED
 * (enforced in service + model hook).
 */
export const createPersonnelSchema = z
  .object({
    mobile,
    password: z.string().min(8).max(128),
    role: z.enum([Roles.USER, Roles.SCANNER]).default(Roles.USER),
    unit: z.string().regex(/^[a-f\d]{24}$/i).optional(),
    rank: z.nativeEnum(Rank).default(Rank.JAWAN),
    maritalStatus: z.nativeEnum(MaritalStatus).default(MaritalStatus.SINGLE),
    spouseMobile: mobile.optional(),
    numberOfKids: z.number().int().min(0).max(20).default(0),
  })
  .refine((d) => d.role !== Roles.USER || !!d.unit, {
    message: 'unit is required for USER personnel',
    path: ['unit'],
  });
export type CreatePersonnelInput = z.infer<typeof createPersonnelSchema>;

/** Bulk import (from an uploaded spreadsheet, parsed client-side into rows). */
export const bulkPersonnelSchema = z.object({
  unit: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid unit id'),
  items: z
    .array(
      z.object({
        mobile,
        password: z.string().min(8).max(128),
        rank: z.nativeEnum(Rank).optional(),
        maritalStatus: z.nativeEnum(MaritalStatus).optional(),
        spouseMobile: mobile.optional(),
        numberOfKids: z.number().int().min(0).max(20).optional(),
      }),
    )
    .min(1)
    .max(1000),
});
export type BulkPersonnelInput = z.infer<typeof bulkPersonnelSchema>;

export const updatePersonnelSchema = z.object({
  unit: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  rank: z.nativeEnum(Rank).optional(),
  maritalStatus: z.nativeEnum(MaritalStatus).optional(),
  spouseMobile: mobile.nullable().optional(),
  numberOfKids: z.number().int().min(0).max(20).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).max(128).optional(),
});
export type UpdatePersonnelInput = z.infer<typeof updatePersonnelSchema>;

export const idParamSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id'),
});

export const personnelListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  unit: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  role: z.enum([Roles.USER, Roles.SCANNER]).optional(),
  // Rank is a USER-only attribute; filtering by it excludes scanners entirely (see service).
  rank: z.nativeEnum(Rank).optional(),
  sort: z.string().trim().max(50).optional(),
});
export type PersonnelListQuery = z.infer<typeof personnelListQuerySchema>;
