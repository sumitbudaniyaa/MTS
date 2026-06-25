import type { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { buildMeta } from '../../utils/pagination.js';
import { AuditLogModel } from '../../models/index.js';
import { AuditAction } from '../../constants/enums.js';
import type { FilterQuery } from 'mongoose';
import type { AuditLog } from '../../models/index.js';

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  action: z.nativeEnum(AuditAction).optional(),
  // Staff actor filter: which authority's logs to show.
  actor: z.enum(['ADMIN', 'SCANNER']).optional(),
});

export const listAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const q = auditQuerySchema.parse(req.query);
  // Only staff (ADMIN/SCANNER) actions are surfaced here — personnel (USER) actions and
  // system entries are excluded. `actor` narrows to one authority.
  const filter: FilterQuery<AuditLog> = {
    userModel: q.actor === 'ADMIN' ? 'Admin' : q.actor === 'SCANNER' ? 'Scanner' : { $in: ['Admin', 'Scanner'] },
  };
  if (q.action) filter.action = q.action;

  const [items, total] = await Promise.all([
    AuditLogModel.find(filter)
      .populate('user', 'mobile name role')
      .sort('-createdAt')
      .skip((q.page - 1) * q.limit)
      .limit(q.limit),
    AuditLogModel.countDocuments(filter),
  ]);
  res.json({ items, ...buildMeta(total, q.page, q.limit) });
});
