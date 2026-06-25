import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { AuditAction } from '../../constants/enums.js';
import { recordAudit } from '../audit/audit.service.js';
import { buildMeta } from '../../utils/pagination.js';
import * as svc from './personnel.service.js';
import { personnelListQuerySchema } from './personnel.schema.js';
import type {
  BulkPersonnelInput,
  CreatePersonnelInput,
  UpdatePersonnelInput,
} from './personnel.schema.js';

export const createPersonnel = asyncHandler(async (req: Request, res: Response) => {
  const user = await svc.createPersonnel(req.body as CreatePersonnelInput);
  await recordAudit({
    action: AuditAction.PERSONNEL_CREATE,
    req,
    metadata: { personnelId: user.id, role: user.role },
  });
  res.status(201).json({ personnel: svc.toPersonnelView(user) });
});

export const bulkCreatePersonnel = asyncHandler(async (req: Request, res: Response) => {
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
  const user = await svc.updatePersonnel(req.params.id as string, req.body as UpdatePersonnelInput);
  res.json({ personnel: svc.toPersonnelView(user) });
});

export const deletePersonnel = asyncHandler(async (req: Request, res: Response) => {
  await svc.deletePersonnel(req.params.id as string);
  res.json({ success: true });
});
