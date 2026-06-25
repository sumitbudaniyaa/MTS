import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/apiError.js';
import { AdminModel } from '../../models/index.js';
import { hashPassword } from '../../utils/password.js';
import { mobileTaken } from '../auth/account.service.js';
import { Roles } from '../../types/index.js';

export const adminRouter = Router();

const createAdminSchema = z.object({
  mobile: z.string().regex(/^\d{10}$/, 'Mobile must be 10 digits'),
  password: z.string().min(6).max(128),
  name: z.string().trim().max(80).optional(),
});

const updateAdminSchema = z.object({
  name: z.string().trim().max(80).optional(),
  active: z.boolean().optional(),
  password: z.string().min(6).max(128).optional(),
});

const idParamSchema = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id') });

adminRouter.use(authenticate, authorize(Roles.ADMIN));

// List administrators.
adminRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const admins = await AdminModel.find({}).sort('-createdAt');
    res.json({ items: admins });
  }),
);

// Create a new administrator.
adminRouter.post(
  '/',
  validate({ body: createAdminSchema }),
  asyncHandler(async (req, res) => {
    const { mobile, password, name } = req.body as z.infer<typeof createAdminSchema>;
    if (await mobileTaken(mobile)) {
      throw ApiError.conflict('An account with this mobile already exists');
    }
    const admin = await AdminModel.create({
      mobile,
      passwordHash: await hashPassword(password),
      name: name ?? '',
    });
    res.status(201).json({ admin });
  }),
);

// Update an administrator (name / active / reset password).
adminRouter.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateAdminSchema }),
  asyncHandler(async (req, res) => {
    const { name, active, password } = req.body as z.infer<typeof updateAdminSchema>;
    const admin = await AdminModel.findById(req.params.id);
    if (!admin) throw ApiError.notFound('Administrator not found');
    if (name !== undefined) admin.name = name;
    if (active !== undefined) admin.active = active;
    if (password) admin.passwordHash = await hashPassword(password);
    await admin.save();
    res.json({ admin });
  }),
);

// Delete an administrator (cannot delete yourself or the last remaining admin).
adminRouter.delete(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    if (req.params.id === req.principal?.sub) {
      throw ApiError.conflict('You cannot delete your own account');
    }
    const count = await AdminModel.countDocuments({});
    if (count <= 1) throw ApiError.conflict('At least one administrator is required');
    const deleted = await AdminModel.findByIdAndDelete(req.params.id);
    if (!deleted) throw ApiError.notFound('Administrator not found');
    res.json({ success: true });
  }),
);
