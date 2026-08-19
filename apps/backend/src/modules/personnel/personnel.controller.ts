import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/apiError.js';
import { AuditAction } from '../../constants/enums.js';
import { recordAudit } from '../audit/audit.service.js';
import { buildMeta } from '../../utils/pagination.js';
import { Roles, type Role } from '../../types/index.js';
import * as svc from './personnel.service.js';
import { personnelListQuerySchema } from './personnel.schema.js';
import type {
  BulkPersonnelInput,
  CreatePersonnelInput,
  UpdatePersonnelInput,
} from './personnel.schema.js';

/**
 * Fine-grained rule: operational ADMINs may manage SCANNER operators, but only a SUPER_ADMIN
 * may create/change/delete USER personnel. `targetRole` is the role of the account being
 * written (USER or SCANNER).
 */
function assertCanManage(principalRole: Role | undefined, targetRole: Role): void {
  if (targetRole === Roles.SCANNER) return; // scanner operators: both admin tiers
  if (principalRole !== Roles.SUPER_ADMIN) {
    throw ApiError.forbidden('Only a super admin can manage personnel');
  }
}

export const createPersonnel = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as CreatePersonnelInput;
  assertCanManage(req.principal?.role, body.role === Roles.SCANNER ? Roles.SCANNER : Roles.USER);
  const { doc, generatedPassword } = await svc.createPersonnel(body);
  await recordAudit({
    action: AuditAction.PERSONNEL_CREATE,
    req,
    // Records THAT a password was generated, never the password itself.
    metadata: { personnelId: doc.id, role: doc.role, generatedPassword: Boolean(generatedPassword) },
  });
  res.status(201).json({
    personnel: svc.toPersonnelView(doc),
    // Shown once to whoever created the account. Nothing stores the plaintext, so if this is
    // lost the only route is an admin reset.
    ...(generatedPassword ? { generatedPassword } : {}),
  });
});

export const bulkCreatePersonnel = asyncHandler(async (req: Request, res: Response) => {
  // Bulk import is always USER personnel — super admin only.
  assertCanManage(req.principal?.role, Roles.USER);
  const result = await svc.createPersonnelBulk(req.body as BulkPersonnelInput);
  await recordAudit({
    action: AuditAction.PERSONNEL_CREATE,
    req,
    metadata: { bulk: true, created: result.created, failed: result.failed.length },
  });
  res.status(201).json(result);
});

export const listPersonnel = asyncHandler(async (req: Request, res: Response) => {
  const query = personnelListQuerySchema.parse(req.query);
  const page = await svc.listPersonnel(query);
  res.json({
    items: page.items.map((u) => svc.toPersonnelView(u)),
    ...buildMeta(page.total, page.page, page.limit),
  });
});

export const getPersonnel = asyncHandler(async (req: Request, res: Response) => {
  const user = await svc.getPersonnel(req.params.id as string);
  res.json({ personnel: svc.toPersonnelView(user) });
});

export const updatePersonnel = asyncHandler(async (req: Request, res: Response) => {
  const existing = await svc.getPersonnel(req.params.id as string);
  assertCanManage(req.principal?.role, existing.role as Role);
  const user = await svc.updatePersonnel(req.params.id as string, req.body as UpdatePersonnelInput);
  const body = req.body as UpdatePersonnelInput & { password?: string };
  await recordAudit({
    action: body.password ? AuditAction.PASSWORD_RESET : AuditAction.PERSONNEL_UPDATE,
    req,
    metadata: {
      personnelId: user.id,
      targetRole: existing.role,
      // Never the password itself — only that one was set.
      changed: { ...body, password: body.password ? true : undefined },
    },
  });
  res.json({ personnel: svc.toPersonnelView(user) });
});

export const deletePersonnel = asyncHandler(async (req: Request, res: Response) => {
  const existing = await svc.getPersonnel(req.params.id as string);
  assertCanManage(req.principal?.role, existing.role as Role);
  await svc.deletePersonnel(req.params.id as string);
  await recordAudit({
    action: AuditAction.PERSONNEL_DELETE,
    req,
    metadata: { personnelId: req.params.id, targetRole: existing.role, mobile: existing.mobile },
  });
  res.json({ success: true });
});

export const unlockPersonnel = asyncHandler(async (req: Request, res: Response) => {
  const existing = await svc.getPersonnel(req.params.id as string);
  assertCanManage(req.principal?.role, existing.role as Role);
  const user = await svc.unlockPersonnel(req.params.id as string);
  await recordAudit({
    action: AuditAction.PERSONNEL_UPDATE,
    req,
    metadata: { personnelId: user.id, targetRole: existing.role, unlocked: true },
  });
  res.json({ success: true, personnel: svc.toPersonnelView(user) });
});
