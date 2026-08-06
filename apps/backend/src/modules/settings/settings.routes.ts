import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { Roles } from '../../types/index.js';
import { updateSettingsSchema } from './settings.schema.js';
import * as ctrl from './settings.controller.js';

export const settingsRouter = Router();

settingsRouter.use(authenticate);

// Both admin tiers can see the current timings…
settingsRouter.get('/', authorize(Roles.ADMIN, Roles.SUPER_ADMIN), ctrl.getSettingsController);
// …but these are operational knobs, so only an operational ADMIN may change them — the same
// separation of duties applied to movies and the auditorium.
settingsRouter.patch(
  '/',
  authorize(Roles.ADMIN),
  validate({ body: updateSettingsSchema }),
  ctrl.updateSettingsController,
);
