import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { env } from '../config/env.js';
import { AdminModel } from '../models/index.js';
import { hashPassword } from '../utils/password.js';
import { Roles } from '../types/index.js';
import { logger } from '../config/logger.js';

/**
 * Bootstraps the very first SUPER_ADMIN account so the system can be operated. The super admin
 * manages units, personnel and admin accounts (and creates operational ADMINs from the app).
 * Idempotent: re-running will not create duplicates. Credentials come from SEED_ADMIN_* env
 * vars. Admin accounts live in their own `admins` collection (separate from users/scanners).
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
      role: Roles.SUPER_ADMIN,
    });
    logger.info(`[seed] created SUPER_ADMIN ${mobile}`);
  }
  await disconnectDatabase();
}

seedAdmin().catch((err) => {
  logger.error({ err }, '[seed] failed');
  process.exit(1);
});
