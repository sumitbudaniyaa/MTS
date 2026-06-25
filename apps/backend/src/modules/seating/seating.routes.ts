import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { bookingLimiter } from '../../middleware/rateLimit.js';
import { Roles } from '../../types/index.js';
import {
  bookSeatsSchema,
  holdSchema,
  movieIdParamSchema,
  releaseSchema,
  saveAuditoriumSchema,
} from './seating.schema.js';
import * as ctrl from './seating.controller.js';

export const seatingRouter = Router();

seatingRouter.use(authenticate);

// ---- Auditorium layout (ADMIN) ----
seatingRouter.get('/auditorium', authorize(Roles.ADMIN), ctrl.getAuditorium);
seatingRouter.put(
  '/auditorium',
  authorize(Roles.ADMIN),
  validate({ body: saveAuditoriumSchema }),
  ctrl.saveAuditorium,
);
seatingRouter.post(
  '/movies/:movieId/generate',
  authorize(Roles.ADMIN),
  validate({ params: movieIdParamSchema }),
  ctrl.generateSeats,
);
seatingRouter.post(
  '/movies/:movieId/open-all',
  authorize(Roles.ADMIN),
  validate({ params: movieIdParamSchema }),
  ctrl.setOpenToAll,
);

// ---- Seat map + booking (USER; admin may read the map) ----
seatingRouter.get(
  '/movies/:movieId/seats',
  authorize(Roles.USER, Roles.ADMIN),
  validate({ params: movieIdParamSchema }),
  ctrl.getSeatMap,
);
seatingRouter.post(
  '/movies/:movieId/hold',
  authorize(Roles.USER),
  validate({ params: movieIdParamSchema, body: holdSchema }),
  ctrl.holdSeats,
);
seatingRouter.post(
  '/movies/:movieId/release',
  authorize(Roles.USER),
  validate({ params: movieIdParamSchema, body: releaseSchema }),
  ctrl.releaseSeats,
);
seatingRouter.post(
  '/movies/:movieId/book',
  authorize(Roles.USER),
  bookingLimiter,
  validate({ params: movieIdParamSchema, body: bookSeatsSchema }),
  ctrl.bookSeats,
);
