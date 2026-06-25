import type { Request } from 'express';
import type { ClientSession, Types } from 'mongoose';
import { AuditLogModel } from '../../models/index.js';
import type { AuditActionType } from '../../constants/enums.js';
import { logger } from '../../config/logger.js';
import { modelNameForRole } from '../auth/account.service.js';
import type { Role } from '../../types/index.js';

interface AuditInput {
  action: AuditActionType;
  user?: Types.ObjectId | string | null;
  /** Actor role — resolves which collection the `user` ref points at (audit refPath). */
  role?: Role;
  req?: Request;
  metadata?: Record<string, unknown>;
  success?: boolean;
  session?: ClientSession;
}

/** Best-effort client IP, honoring the trusted proxy hop. */
function clientIp(req?: Request): string | null {
  if (!req) return null;
  return req.ip ?? req.socket?.remoteAddress ?? null;
}

/**
 * Write an append-only audit entry. Audit failures must never break the primary operation,
 * so errors are logged and swallowed (unless running inside a caller-provided transaction,
 * where the caller decides atomicity).
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const user = input.user ?? input.req?.principal?.sub ?? null;
    const role = input.role ?? input.req?.principal?.role;
    await AuditLogModel.create(
      [
        {
          action: input.action,
          user,
          userModel: user && role ? modelNameForRole(role) : null,
          ip: clientIp(input.req),
          userAgent: input.req?.headers['user-agent'] ?? null,
          metadata: input.metadata ?? {},
          success: input.success ?? true,
        },
      ],
      input.session ? { session: input.session } : {},
    );
  } catch (err) {
    if (input.session) throw err;
    logger.error({ err, action: input.action }, '[audit] failed to record');
  }
}
