import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { scannerLimiter } from '../../middleware/rateLimit.js';
import { Roles } from '../../types/index.js';
import { movieIdParamSchema, verifySchema } from './attendance.schema.js';
import * as ctrl from './attendance.controller.js';

export const attendanceRouter = Router();

attendanceRouter.use(authenticate);

// QR verification — door staff, plus the operational ADMIN, who runs the show and scans from
// their own console. Rate-limited for door throughput.
attendanceRouter.post(
  '/verify',
  authorize(Roles.SCANNER, Roles.ADMIN),
  scannerLimiter,
  validate({ body: verifySchema }),
  ctrl.verifyTicket,
);

// Attendance roll-up — SCANNER or ADMIN.
attendanceRouter.get(
  '/movies/:movieId/summary',
  authorize(Roles.SCANNER, Roles.ADMIN, Roles.SUPER_ADMIN),
  validate({ params: movieIdParamSchema }),
  ctrl.attendanceSummary,
);
