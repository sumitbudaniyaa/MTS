import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { Roles } from '../../types/index.js';
import {
  bulkPersonnelSchema,
  createPersonnelSchema,
  idParamSchema,
  personnelListQuerySchema,
  updatePersonnelSchema,
} from './personnel.schema.js';
import * as ctrl from './personnel.controller.js';

export const personnelRouter = Router();

// Both admin tiers reach these routes; the controller enforces the fine-grained rule:
// USER personnel writes are SUPER_ADMIN-only, while SCANNER-operator writes are allowed for
// operational ADMINs too. Reads are open to both tiers.
personnelRouter.use(authenticate, authorize(Roles.ADMIN, Roles.SUPER_ADMIN));

personnelRouter.post('/', validate({ body: createPersonnelSchema }), ctrl.createPersonnel);
personnelRouter.post('/bulk', validate({ body: bulkPersonnelSchema }), ctrl.bulkCreatePersonnel);
personnelRouter.get('/', validate({ query: personnelListQuerySchema }), ctrl.listPersonnel);
personnelRouter.get('/:id', validate({ params: idParamSchema }), ctrl.getPersonnel);
personnelRouter.patch(
  '/:id',
  validate({ params: idParamSchema, body: updatePersonnelSchema }),
  ctrl.updatePersonnel,
);
personnelRouter.delete('/:id', validate({ params: idParamSchema }), ctrl.deletePersonnel);
personnelRouter.post('/:id/unlock', validate({ params: idParamSchema }), ctrl.unlockPersonnel);
