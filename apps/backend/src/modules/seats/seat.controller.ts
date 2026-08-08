import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { AuditAction } from '../../constants/enums.js';
import { recordAudit } from '../audit/audit.service.js';
import * as svc from './seat.service.js';
import type { SetAllocationsInput } from './seat.schema.js';

export const setAllocations = asyncHandler(async (req: Request, res: Response) => {
  const allocations = await svc.setAllocations(
    req.params.movieId as string,
    req.body as SetAllocationsInput,
  );
  // Who gave which unit how many seats — the question every allocation dispute turns on.
  await recordAudit({
    action: AuditAction.SEAT_ALLOCATION_SET,
    req,
    metadata: {
      movieId: req.params.movieId,
      allocations: allocations.map((a) => ({ unit: String(a.unit), allocated: a.allocated })),
    },
  });
  res.json({ allocations });
});

export const listAllocations = asyncHandler(async (req: Request, res: Response) => {
  res.json({ allocations: await svc.listAllocations(req.params.movieId as string) });
});
