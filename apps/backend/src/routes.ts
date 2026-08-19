import { Router } from 'express';
import { authenticateOptional, requireCurrentPassword } from './middleware/auth.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { unitRouter } from './modules/units/unit.routes.js';
import { personnelRouter } from './modules/personnel/personnel.routes.js';
import { movieRouter } from './modules/movies/movie.routes.js';
import { seatRouter } from './modules/seats/seat.routes.js';
import { bookingRouter } from './modules/bookings/booking.routes.js';
import { attendanceRouter } from './modules/attendance/attendance.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { reportRouter } from './modules/reports/report.routes.js';
import { adminRouter } from './modules/admins/admin.routes.js';
import { seatingRouter } from './modules/seating/seating.routes.js';
import { settingsRouter } from './modules/settings/settings.routes.js';

/**
 * Central API router. Feature module routers are mounted here as they are built
 * (auth, units, personnel, movies, seats, bookings, attendance, audit, reports).
 */
export const apiRouter = Router();

apiRouter.get('/', (_req, res) => {
  res.json({ name: 'Auditorium Booking API', version: 'v1' });
});

// `/auth` is deliberately NOT gated: an account whose temporary password has expired still has
// to reach `/auth/me` and `/auth/change-password`, or it could never recover.
apiRouter.use('/auth', authRouter);

// Everything past here refuses an account whose borrowed password ran out of time. Mounted once
// here rather than per-router so a new feature slice cannot forget it.
//
// `authenticateOptional` has to run first: each feature router mounts its own `authenticate`,
// which happens *after* this point, so without a best-effort read there is no `req.principal`
// here and the gate would wave everyone through. Optional rather than strict because some routes
// past here are public (`/movies/available`) — an absent or bad token is left for the routers'
// own `authenticate` to reject.
apiRouter.use(authenticateOptional, requireCurrentPassword);

apiRouter.use('/units', unitRouter);
apiRouter.use('/personnel', personnelRouter);
apiRouter.use('/movies', movieRouter);
apiRouter.use('/seat-allocations', seatRouter);
apiRouter.use('/bookings', bookingRouter);
apiRouter.use('/attendance', attendanceRouter);
apiRouter.use('/audit-logs', auditRouter);
apiRouter.use('/reports', reportRouter);
apiRouter.use('/admins', adminRouter);
apiRouter.use('/seating', seatingRouter);
apiRouter.use('/settings', settingsRouter);
