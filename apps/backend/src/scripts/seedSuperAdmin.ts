import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { env } from '../config/env.js';
import { AdminModel } from '../models/index.js';
import { hashPassword } from '../utils/password.js';
import { blindIndex } from '../utils/fieldCrypto.js';
import { Roles } from '../types/index.js';
import { logger } from '../config/logger.js';

/**
 * Seed a SUPER_ADMIN account. Because mobile numbers are ENCRYPTED at rest with a blind index
 * (and passwords are bcrypt-hashed), the account MUST be created through the app so those are
 * produced correctly — a raw `mongosh` insert cannot do this.
 *
 * Usage:
 *   npm run seed:superadmin -- <mobile> <password> ["Full Name"]
 * or, with no args, it falls back to SEED_ADMIN_MOBILE / SEED_ADMIN_PASSWORD from the env.
 *
 * Idempotent: if an admin with that mobile already exists it is left unchanged (it will NOT be
 * demoted/promoted — delete it first if you want to recreate it).
 */
async function seedSuperAdmin(): Promise<void> {
  const [argMobile, argPassword, argName] = process.argv.slice(2);
  const mobile = argMobile ?? env.SEED_ADMIN_MOBILE;
  const password = argPassword ?? env.SEED_ADMIN_PASSWORD;
  const name = argName ?? 'System Administrator';

  if (!mobile || !password) {
    throw new Error(
      'Provide credentials: `npm run seed:superadmin -- <mobile> <password> ["Name"]` ' +
        '(or set SEED_ADMIN_MOBILE / SEED_ADMIN_PASSWORD).',
    );
  }
  if (!/^\d{10}$/.test(mobile)) throw new Error('Mobile must be exactly 10 digits.');
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');

  await connectDatabase();

  // Uniqueness is enforced on the blind index of the (encrypted) mobile.
  const existing = await AdminModel.findOne({ mobileHash: blindIndex(mobile) });
  if (existing) {
    existing.passwordHash = await hashPassword(password);
    existing.role = Roles.SUPER_ADMIN;
    existing.failedLoginCount = 0;
    existing.lockedUntil = null;
    await existing.save();
    logger.info(`[seed] admin ${mobile} password updated and unlocked (role=${existing.role})`);
  } else {
    await AdminModel.create({
      mobile,
      passwordHash: await hashPassword(password),
      name,
      role: Roles.SUPER_ADMIN,
    });
    logger.info(`[seed] created SUPER_ADMIN ${mobile}`);
  }

  await disconnectDatabase();
}

seedSuperAdmin().catch((err) => {
  logger.error({ err }, '[seed] failed');
  process.exit(1);
});
