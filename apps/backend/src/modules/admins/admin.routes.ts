import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/apiError.js';
import { AuditAction } from '../../constants/enums.js';
import { recordAudit } from '../audit/audit.service.js';
import { AdminModel } from '../../models/index.js';
import { hashPassword } from '../../utils/password.js';
import { mobileTaken } from '../auth/account.service.js';
import { Roles } from '../../types/index.js';

export const adminRouter = Router();

const createAdminSchema = z.object({
  mobile: z.string().regex(/^\d{10}$/, 'Mobile must be 10 digits'),
  password: z.string().min(8).max(128),
  name: z.string().trim().max(80).optional(),
  // Which tier to create. Defaults to an operational ADMIN.
  role: z.enum([Roles.ADMIN, Roles.SUPER_ADMIN]).optional(),
});

const updateAdminSchema = z.object({
  name: z.string().trim().max(80).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).max(128).optional(),
});

const idParamSchema = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id') });

// Managing admin accounts is SUPER_ADMIN only.
adminRouter.use(authenticate, authorize(Roles.SUPER_ADMIN));

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
    const { mobile, password, name, role } = req.body as z.infer<typeof createAdminSchema>;
    if (await mobileTaken(mobile, Roles.ADMIN)) {
      throw ApiError.conflict('An account with this mobile already exists');
    }
    const admin = await AdminModel.create({
      mobile,
      passwordHash: await hashPassword(password),
      name: name ?? '',
      role: role ?? Roles.ADMIN,
    });
    // Privilege grant — the tier is the whole point of the record.
    await recordAudit({
      action: AuditAction.ADMIN_CREATE,
      req,
      metadata: { adminId: admin.id, grantedRole: admin.role, name: admin.name },
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
    // Record WHICH levers moved, never the password itself. Deactivating an account and
    // resetting someone else's credentials are both privilege events.
    await recordAudit({
      action: password ? AuditAction.PASSWORD_RESET : AuditAction.ADMIN_UPDATE,
      req,
      metadata: {
        adminId: admin.id,
        changed: {
          ...(name !== undefined ? { name } : {}),
          ...(active !== undefined ? { active } : {}),
          ...(password ? { passwordReset: true } : {}),
        },
      },
    });
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
    const target = await AdminModel.findById(req.params.id);
    if (!target) throw ApiError.notFound('Administrator not found');
    // Never leave the system without a super admin (only they can manage admin accounts).
    if (target.role === Roles.SUPER_ADMIN) {
      const superCount = await AdminModel.countDocuments({ role: Roles.SUPER_ADMIN });
      if (superCount <= 1) throw ApiError.conflict('At least one super admin is required');
    }
    // Capture the tier before the document goes — afterwards there is nothing left to read.
    const removed = { adminId: target.id, role: target.role, name: target.name };
    await target.deleteOne();
    await recordAudit({ action: AuditAction.ADMIN_DELETE, req, metadata: removed });
    res.json({ success: true });
  }),
);

// Unlock a locked-out administrator account.
adminRouter.post(
  '/:id/unlock',
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const admin = await AdminModel.findById(req.params.id);
    if (!admin) throw ApiError.notFound('Administrator not found');
    admin.failedLoginCount = 0;
    admin.lockedUntil = null;
    await admin.save();
    await recordAudit({
      action: AuditAction.ADMIN_UPDATE,
      req,
      metadata: { adminId: admin.id, unlocked: true },
    });
    res.json({ success: true, admin });
  }),
);
