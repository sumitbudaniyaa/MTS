import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { env } from '../config/env.js';
import { AdminModel } from '../models/index.js';
import { hashPassword } from '../utils/password.js';
import { logger } from '../config/logger.js';

/**
 * Bootstraps the very first ADMIN account so the system can be operated. Idempotent:
 * re-running will not create duplicates. Credentials come from SEED_ADMIN_* env vars.
 *
 * Admin accounts now live in their own `admins` collection (separate from users/scanners).
 */
async function seedAdmin(): Promise<void> {
  const mobile = env.SEED_ADMIN_MOBILE;
  const password = env.SEED_ADMIN_PASSWORD;
  if (!mobile || !password) {
    throw new Error('SEED_ADMIN_MOBILE and SEED_ADMIN_PASSWORD must be set');
  }

  await connectDatabase();
  const existing = await AdminModel.findOne({ mobile });
  if (existing) {
    logger.info(`[seed] admin ${mobile} already exists — skipping`);
  } else {
    await AdminModel.create({
      mobile,
      passwordHash: await hashPassword(password),
      name: 'System Administrator',
    });
    logger.info(`[seed] created ADMIN ${mobile}`);
  }
  await disconnectDatabase();
}

seedAdmin().catch((err) => {
  logger.error({ err }, '[seed] failed');
  process.exit(1);
});
