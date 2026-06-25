import type { Schema } from 'mongoose';

/**
 * Standard JSON serialization for all models: expose a string `id`, drop `_id`/`__v`, and
 * never leak secret fields (`passwordHash`, `tokenHash`) even if a doc is accidentally
 * serialized without an explicit projection. Apply to every schema before model compilation.
 */
export function applyBaseTransforms(schema: Schema): void {
  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform(_doc, ret: Record<string, unknown>) {
      ret.id = ret._id !== undefined && ret._id !== null ? String(ret._id) : ret.id;
      delete ret._id;
      delete ret.passwordHash;
      delete ret.tokenHash;
      return ret;
    },
  });
}
