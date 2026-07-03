import crypto from 'node:crypto';
import type { Schema } from 'mongoose';
import { env } from '../config/env.js';

/**
 * At-rest field encryption for sensitive identifiers (mobile numbers, unit names).
 *
 * Two keys are derived from `FIELD_ENCRYPTION_KEY` (via scrypt, so a passphrase works):
 *   - an AES-256-GCM key → reversible ciphertext for display, and
 *   - an HMAC-SHA256 key → a deterministic **blind index** used for equality lookups and
 *     uniqueness (you can't query non-deterministic ciphertext).
 *
 * The plaintext never touches the DB: models store ciphertext in the field plus a `<field>Hash`
 * blind index. A getter transparently decrypts on read; a save/insert hook seals on write.
 */

const AES_KEY = crypto.scryptSync(env.FIELD_ENCRYPTION_KEY, 'field-aes-v1', 32);
const HMAC_KEY = crypto.scryptSync(env.FIELD_ENCRYPTION_KEY, 'field-hmac-v1', 32);

const PREFIX = 'enc:v1:'; // marks our ciphertext so getters can passthrough anything else

/** Encrypt a string → `enc:v1:<iv>:<tag>:<ciphertext>` (all base64). */
export function encryptField(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', AES_KEY, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/** Decrypt a value produced by {@link encryptField}. Non-ciphertext is returned unchanged. */
export function decryptField(value: string): string {
  if (!isCiphertext(value)) return value;
  const [ivB, tagB, ctB] = value.slice(PREFIX.length).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', AES_KEY, Buffer.from(ivB!, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB!, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB!, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}

export function isCiphertext(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/** Deterministic keyed hash for equality lookups / uniqueness (normalized: trimmed). */
export function blindIndex(plain: string): string {
  return crypto.createHmac('sha256', HMAC_KEY).update(plain.trim()).digest('hex');
}

/** Decrypt only if needed; never throws on unexpected input (returns the raw value). */
function safeDecrypt(value: unknown): unknown {
  if (!isCiphertext(value)) return value;
  try {
    return decryptField(value);
  } catch {
    return value;
  }
}

export interface EncryptedFieldSpec {
  /** The schema path whose value is encrypted at rest. */
  field: string;
  /** The companion blind-index path (added by this plugin). */
  hash: string;
  /** Enforce uniqueness on the blind index (e.g. login mobile). */
  unique?: boolean;
}

/**
 * Mongoose plugin: for each spec, add a blind-index path + index, decrypt-on-read getter, and
 * seal-on-write hooks (both `save` and `insertMany`). Call BEFORE `model()`.
 */
export function applyFieldEncryption(schema: Schema, specs: EncryptedFieldSpec[]): void {
  for (const spec of specs) {
    schema.add({ [spec.hash]: { type: String, default: null } });
    schema.index(
      { [spec.hash]: 1 },
      spec.unique ? { unique: true, sparse: true } : { sparse: true },
    );
    schema.path(spec.field).get((v: unknown) => safeDecrypt(v));
  }

  schema.pre('save', function sealOnSave(next) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = this as any;
    for (const spec of specs) {
      if (!doc.isModified(spec.field)) continue;
      const plain = doc.get(spec.field); // getter → plaintext (passthrough or decrypted)
      if (plain === null || plain === undefined || plain === '') {
        doc.set(spec.hash, null);
        continue;
      }
      const p = String(plain).trim();
      doc.set(spec.hash, blindIndex(p));
      doc.set(spec.field, encryptField(p)); // store ciphertext (raw, no setter)
    }
    next();
  });

  schema.pre('insertMany', function sealOnInsertMany(next, docs) {
    if (Array.isArray(docs)) {
      for (const raw of docs) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = raw as any;
        for (const spec of specs) {
          const plain = d[spec.field];
          if (plain === null || plain === undefined || plain === '') {
            d[spec.hash] = null;
            continue;
          }
          const p = String(plain).trim();
          d[spec.hash] = blindIndex(p);
          d[spec.field] = encryptField(p);
        }
      }
    }
    next();
  });
}
