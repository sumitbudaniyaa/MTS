import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { bookingLimiter } from '../../middleware/rateLimit.js';
import { Roles } from '../../types/index.js';
import { createBookingSchema, idParamSchema } from './booking.schema.js';
import * as ctrl from './booking.controller.js';

export const bookingRouter = Router();

// All booking operations are USER-only.
bookingRouter.use(authenticate, authorize(Roles.USER));

bookingRouter.post('/', bookingLimiter, validate({ body: createBookingSchema }), ctrl.createBooking);
bookingRouter.get('/', ctrl.listMyBookings);
// Remaining ticket allowance for a movie (drives the booking quantity cap).
bookingRouter.get('/allowance/:movieId', ctrl.getAllowance);
bookingRouter.get('/:id', validate({ params: idParamSchema }), ctrl.getMyBooking);
bookingRouter.post('/:id/cancel', validate({ params: idParamSchema }), ctrl.cancelBooking);
