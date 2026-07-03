import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { Roles } from '../../types/index.js';
import * as svc from './report.service.js';

export const reportRouter = Router();

const movieIdParamSchema = z.object({ movieId: z.string().regex(/^[a-f\d]{24}$/i) });

reportRouter.use(authenticate, authorize(Roles.ADMIN, Roles.SUPER_ADMIN));

reportRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    res.json(await svc.overview());
  }),
);

reportRouter.get(
  '/movies/:movieId',
  validate({ params: movieIdParamSchema }),
  asyncHandler(async (req, res) => {
    res.json(await svc.movieReport(req.params.movieId as string));
  }),
);
