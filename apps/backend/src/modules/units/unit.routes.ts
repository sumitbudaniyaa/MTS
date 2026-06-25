import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { listQuerySchema } from '../../utils/pagination.js';
import { Roles } from '../../types/index.js';
import { createUnitSchema, idParamSchema, updateUnitSchema } from './unit.schema.js';
import * as ctrl from './unit.controller.js';

export const unitRouter = Router();

// All unit management is ADMIN-only.
unitRouter.use(authenticate, authorize(Roles.ADMIN));

unitRouter.post('/', validate({ body: createUnitSchema }), ctrl.createUnit);
unitRouter.get('/', validate({ query: listQuerySchema }), ctrl.listUnits);
unitRouter.get('/:id', validate({ params: idParamSchema }), ctrl.getUnit);
unitRouter.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateUnitSchema }),
  ctrl.updateUnit,
);
unitRouter.delete('/:id', validate({ params: idParamSchema }), ctrl.deleteUnit);
