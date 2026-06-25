import mongoose from 'mongoose';
import { logger } from '../config/logger.js';

let transactionSupportChecked = false;
let supportsTransactions = false;

/**
 * Reliably detect transaction support by asking the server itself.
 * Multi-document transactions require a replica set (reports a `setName`) or a sharded
 * cluster (mongos, `msg: 'isdbgrid'`). A plain standalone `mongod` supports neither —
 * and crucially, `startTransaction()`/`abortTransaction()` are client-side no-ops there,
 * so they can't be used to probe support (they don't error until a real op runs).
 */
async function detectTransactionSupport(): Promise<boolean> {
  try {
    const db = mongoose.connection.db;
    if (!db) return false;
    const info = (await db.admin().command({ hello: 1 })) as { setName?: string; msg?: string };
    const supported = Boolean(info.setName) || info.msg === 'isdbgrid';
    if (!supported) {
      logger.warn(
        '[db] Standalone MongoDB detected — transactions disabled. Booking/allocation run ' +
          'non-atomically (fine for local dev; use a replica set / Atlas for production).',
      );
    }
    return supported;
  } catch (err) {
    logger.warn({ err }, '[db] could not detect transaction support; assuming none');
    return false;
  }
}

/**
 * Runs `fn` inside a transaction when the connected server supports it, otherwise runs it
 * directly with no session. The callback must pass `session` through to every DB call.
 */
export async function runInTransaction<T>(
  fn: (session: mongoose.ClientSession | undefined) => Promise<T>,
): Promise<T> {
  if (!transactionSupportChecked) {
    supportsTransactions = await detectTransactionSupport();
    transactionSupportChecked = true;
  }

  if (!supportsTransactions) {
    return fn(undefined);
  }

  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => fn(session));
  } finally {
    await session.endSession();
  }
}
