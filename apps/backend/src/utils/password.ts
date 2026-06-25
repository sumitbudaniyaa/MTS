import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

/** Hash a plaintext password with bcrypt using the configured cost factor. */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_ROUNDS);
}

/** Constant-time verify of a plaintext password against a stored bcrypt hash. */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
