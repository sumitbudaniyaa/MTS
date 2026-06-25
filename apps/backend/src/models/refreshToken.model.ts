import { applyBaseTransforms } from './_shared.js';
import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * Rotating refresh token record. The raw token is NEVER stored — only its SHA-256 hash.
 * Tokens are grouped into a `family`: on rotation the old token is revoked and `replacedBy`
 * points to its successor. If a revoked token is ever presented again (reuse / theft), the
 * whole family is revoked. Expired documents are auto-removed via a TTL index.
 */
const refreshTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, required: true, index: true },
    // Which collection the account lives in (accounts are split by role).
    role: { type: String, required: true },
    tokenHash: { type: String, required: true, unique: true },
    family: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedBy: { type: String, default: null }, // tokenHash of the successor
    createdByIp: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

// Auto-purge expired tokens.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshToken = InferSchemaType<typeof refreshTokenSchema>;
export type RefreshTokenDoc = HydratedDocument<RefreshToken>;

applyBaseTransforms(refreshTokenSchema);

export const RefreshTokenModel = model('RefreshToken', refreshTokenSchema);
