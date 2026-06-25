import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/apiError.js';
import * as svc from './attendance.service.js';
import type { VerifyInput } from './attendance.schema.js';

export const verifyTicket = asyncHandler(async (req: Request, res: Response) => {
  if (!req.principal) throw ApiError.unauthorized();
  const { code } = req.body as VerifyInput;
  const result = await svc.verifyTicket(code, req.principal.sub, req);
  res.json({ verified: true, ticket: result });
});

export const attendanceSummary = asyncHandler(async (req: Request, res: Response) => {
  res.json(await svc.attendanceSummary(req.params.movieId as string));
});
