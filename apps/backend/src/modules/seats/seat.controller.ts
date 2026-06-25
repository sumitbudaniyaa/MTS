import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as svc from './seat.service.js';
import type { SetAllocationsInput } from './seat.schema.js';

export const setAllocations = asyncHandler(async (req: Request, res: Response) => {
  const allocations = await svc.setAllocations(
    req.params.movieId as string,
    req.body as SetAllocationsInput,
  );
  res.json({ allocations });
});

export const listAllocations = asyncHandler(async (req: Request, res: Response) => {
  res.json({ allocations: await svc.listAllocations(req.params.movieId as string) });
});
