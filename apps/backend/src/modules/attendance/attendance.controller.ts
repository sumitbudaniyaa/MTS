import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/apiError.js';
import * as svc from './attendance.service.js';
import { Roles } from '../../types/index.js';
import type { VerifyInput } from './attendance.schema.js';

export const verifyTicket = asyncHandler(async (req: Request, res: Response) => {
  if (!req.principal) throw ApiError.unauthorized();
  const { code } = req.body as VerifyInput;
  // Door staff are Scanner accounts; an operational ADMIN scans from their own console. The
  // ticket records which, so a check-in is always attributable to a real account.
  const actorModel = req.principal.role === Roles.SCANNER ? 'Scanner' : 'Admin';
  const result = await svc.verifyTicket(code, req.principal.sub, req, actorModel);
  res.json({ verified: true, ticket: result });
});

export const attendanceSummary = asyncHandler(async (req: Request, res: Response) => {
  res.json(await svc.attendanceSummary(req.params.movieId as string));
});
