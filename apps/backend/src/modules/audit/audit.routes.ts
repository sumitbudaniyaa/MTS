import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { Roles } from '../../types/index.js';
import { auditQuerySchema, listAuditLogs } from './audit.controller.js';

export const auditRouter = Router();

// Audit trail is ADMIN-only and read-only.
auditRouter.use(authenticate, authorize(Roles.ADMIN));
auditRouter.get('/', validate({ query: auditQuerySchema }), listAuditLogs);
