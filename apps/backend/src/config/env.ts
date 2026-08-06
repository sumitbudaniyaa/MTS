import 'dotenv/config'; // load apps/backend/.env for local dev (no-op if absent)
import { z } from 'zod';

/**
 * Single source of truth for runtime configuration.
 * Validated with Zod at process start — the process exits on invalid config so we never
 * boot into an undefined/insecure state.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),

  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be >= 32 chars'),
  // Master key for at-rest field encryption (mobiles, unit names). AES-256-GCM + HMAC blind
  // index are derived from it. MUST be stable — rotating it makes existing ciphertext/indexes
  // unreadable. Keep it as secret as the JWT secrets.
  FIELD_ENCRYPTION_KEY: z.string().min(32, 'FIELD_ENCRYPTION_KEY must be >= 32 chars'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),

  // Cookie Domain. Leave blank for a host-only cookie (correct for localhost and most single
  // hosts). A literal "localhost" is treated as blank — browsers reject Domain=localhost, which
  // would drop the refresh cookie and log users out on every reload. Set a real registrable
  // domain (e.g. ".example.com") only when sharing the cookie across subdomains.
  COOKIE_DOMAIN: z.string().default(''),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((s) => s === 'true'),
  // 'strict' for same-site (subdomains/one origin); 'none' for cross-site hosting
  // (e.g. free split hosting: app on Netlify, API on Render). 'none' requires Secure=true.
  COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('strict'),

  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  // Seed values for the runtime-editable operational settings (see config/settings.ts). They
  // are used the first time the app starts; after that the admin-managed values in the
  // database win, so changing these later has no effect on an existing deployment.
  NO_SHOW_GRACE_MINUTES: z.coerce.number().int().positive().default(15),
  VISIBILITY_LEAD_MINUTES: z.coerce.number().int().positive().default(60),
  SEAT_HOLD_SECONDS: z.coerce.number().int().positive().default(120),

  SEED_ADMIN_MOBILE: z.string().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
});

export type AppEnv = z.infer<typeof EnvSchema>;

function loadEnv(): AppEnv {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail fast with a readable message; never start with bad config.
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(`\n[config] Invalid environment configuration:\n${issues}\n`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
