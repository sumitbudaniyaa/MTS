import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { listQuerySchema } from '../../utils/pagination.js';
import { AuditAction } from '../../constants/enums.js';
import { recordAudit } from '../audit/audit.service.js';
import * as unitService from './unit.service.js';
import type { CreateUnitInput, UpdateUnitInput } from './unit.schema.js';

export const createUnit = asyncHandler(async (req: Request, res: Response) => {
  const unit = await unitService.createUnit(req.body as CreateUnitInput);
  await recordAudit({ action: AuditAction.UNIT_CREATE, req, metadata: { unitId: unit.id } });
  res.status(201).json({ unit });
});

export const listUnits = asyncHandler(async (req: Request, res: Response) => {
  const query = listQuerySchema.parse(req.query);
  res.json(await unitService.listUnits(query));
});

export const getUnit = asyncHandler(async (req: Request, res: Response) => {
  res.json({ unit: await unitService.getUnit(req.params.id as string) });
});

export const updateUnit = asyncHandler(async (req: Request, res: Response) => {
  const unit = await unitService.updateUnit(req.params.id as string, req.body as UpdateUnitInput);
  await recordAudit({
    action: AuditAction.UNIT_UPDATE,
    req,
    metadata: { unitId: unit.id, changed: req.body },
  });
  res.json({ unit });
});

export const deleteUnit = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  // Read the name before deleting — an id alone tells a later reader nothing.
  const doomed = await unitService.getUnit(id).catch(() => null);
  await unitService.deleteUnit(id);
  await recordAudit({
    action: AuditAction.UNIT_DELETE,
    req,
    metadata: { unitId: id, name: doomed?.name ?? null },
  });
  res.json({ success: true });
});
