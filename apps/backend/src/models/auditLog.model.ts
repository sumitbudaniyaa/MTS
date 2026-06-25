import { applyBaseTransforms } from './_shared.js';
import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { AuditAction } from '../constants/enums.js';

/**
 * Append-only audit trail. Never updated or deleted in normal operation. Captures who did
 * what, when, from where, with structured metadata for forensic review.
 */
const auditLogSchema = new Schema(
  {
    // Actor may be an Admin, Scanner or User — refPath resolves the right collection.
    user: { type: Schema.Types.ObjectId, refPath: 'userModel', default: null, index: true },
    userModel: { type: String, enum: ['Admin', 'Scanner', 'User'], default: null },
    action: { type: String, enum: Object.values(AuditAction), required: true, index: true },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
    success: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

auditLogSchema.index({ createdAt: -1 });

export type AuditLog = InferSchemaType<typeof auditLogSchema>;
export type AuditLogDoc = HydratedDocument<AuditLog>;

applyBaseTransforms(auditLogSchema);

export const AuditLogModel = model('AuditLog', auditLogSchema);
