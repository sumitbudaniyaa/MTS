import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { Roles } from '../../types/index.js';
import { movieIdParamSchema, setAllocationsSchema } from './seat.schema.js';
import * as ctrl from './seat.controller.js';

export const seatRouter = Router();

// Seat allocation is ADMIN-only.
seatRouter.use(authenticate, authorize(Roles.ADMIN));

seatRouter.put(
  '/:movieId',
  validate({ params: movieIdParamSchema, body: setAllocationsSchema }),
  ctrl.setAllocations,
);
seatRouter.get('/:movieId', validate({ params: movieIdParamSchema }), ctrl.listAllocations);
