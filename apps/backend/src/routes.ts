import { Router } from 'express';
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

/**
 * Central API router. Feature module routers are mounted here as they are built
 * (auth, units, personnel, movies, seats, bookings, attendance, audit, reports).
 */
export const apiRouter = Router();

apiRouter.get('/', (_req, res) => {
  res.json({ name: 'Auditorium Booking API', version: 'v1' });
});

apiRouter.use('/auth', authRouter);
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
