import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { listQuerySchema } from '../../utils/pagination.js';
import { Roles } from '../../types/index.js';
import { createUnitSchema, idParamSchema, updateUnitSchema } from './unit.schema.js';
import * as ctrl from './unit.controller.js';

export const unitRouter = Router();

unitRouter.use(authenticate);

// Reads: both admin tiers.
unitRouter.get('/', authorize(Roles.ADMIN, Roles.SUPER_ADMIN), validate({ query: listQuerySchema }), ctrl.listUnits);
unitRouter.get('/:id', authorize(Roles.ADMIN, Roles.SUPER_ADMIN), validate({ params: idParamSchema }), ctrl.getUnit);

// Writes: SUPER_ADMIN only — operational admins are read-only on units.
unitRouter.post('/', authorize(Roles.SUPER_ADMIN), validate({ body: createUnitSchema }), ctrl.createUnit);
unitRouter.patch(
  '/:id',
  authorize(Roles.SUPER_ADMIN),
  validate({ params: idParamSchema, body: updateUnitSchema }),
  ctrl.updateUnit,
);
unitRouter.delete('/:id', authorize(Roles.SUPER_ADMIN), validate({ params: idParamSchema }), ctrl.deleteUnit);
