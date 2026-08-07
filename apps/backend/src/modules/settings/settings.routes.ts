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
// …but **SUPER_ADMIN** changes them. These are set-once-and-forget policy knobs, and the
// operational ADMIN's console is now a phone-sized movies/scanners/scan tool with no room —
// and no need — for them. Kept with the auditorium so venue policy lives in one tier.
settingsRouter.patch(
  '/',
  authorize(Roles.SUPER_ADMIN),
  validate({ body: updateSettingsSchema }),
  ctrl.updateSettingsController,
);
