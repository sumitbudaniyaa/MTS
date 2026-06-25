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

// Personnel management is ADMIN-only.
personnelRouter.use(authenticate, authorize(Roles.ADMIN));

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
