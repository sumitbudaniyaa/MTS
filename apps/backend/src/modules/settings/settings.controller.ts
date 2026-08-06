import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { loadSettings, saveSettings, settings } from '../../config/settings.js';
import { AuditAction } from '../../constants/enums.js';
import { recordAudit } from '../audit/audit.service.js';
import type { UpdateSettingsInput } from './settings.schema.js';

/**
 * Read the live settings straight from the database rather than this worker's cache, so an
 * admin who saves on one worker and reloads onto another never sees a stale form.
 */
export const getSettingsController = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ settings: await loadSettings() });
});

export const updateSettingsController = asyncHandler(async (req: Request, res: Response) => {
  const patch = req.body as UpdateSettingsInput;
  const before = settings();
  const updated = await saveSettings(patch, req.principal?.sub);
  await recordAudit({
    action: AuditAction.SETTINGS_UPDATE,
    user: req.principal?.sub,
    role: req.principal?.role,
    req,
    metadata: { before, after: updated },
  });
  res.json({ settings: updated });
});
