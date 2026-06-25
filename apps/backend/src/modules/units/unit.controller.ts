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
  res.json({ unit });
});

export const deleteUnit = asyncHandler(async (req: Request, res: Response) => {
  await unitService.deleteUnit(req.params.id as string);
  res.json({ success: true });
});
