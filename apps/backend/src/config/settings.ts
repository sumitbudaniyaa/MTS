import { SettingsModel, SETTINGS_ID } from '../models/settings.model.js';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * Runtime-tunable operational timings, cached in memory.
 *
 * These are read on hot synchronous paths (`isMovieVisible`, seat holds, the reconciliation
 * jobs), so `settings()` never touches the database — it serves a process-local cache that is
 * primed at boot, refreshed whenever an admin saves, and re-read periodically.
 *
 * That last part matters under PM2 cluster mode: a save handled by one worker is invisible to
 * the others until they re-read, so a change takes up to `REFRESH_MS` to apply fleet-wide.
 * The env vars remain the seed values used the first time the app ever starts.
 */
export interface AppSettings {
  visibilityLeadMinutes: number;
  noShowGraceMinutes: number;
  seatHoldSeconds: number;
}

const REFRESH_MS = 30_000;

const seed: AppSettings = {
  visibilityLeadMinutes: env.VISIBILITY_LEAD_MINUTES,
  noShowGraceMinutes: env.NO_SHOW_GRACE_MINUTES,
  seatHoldSeconds: env.SEAT_HOLD_SECONDS,
};

let cache: AppSettings = { ...seed };
let timer: NodeJS.Timeout | null = null;

function pick(doc: {
  visibilityLeadMinutes: number;
  noShowGraceMinutes: number;
  seatHoldSeconds: number;
}): AppSettings {
  return {
    visibilityLeadMinutes: doc.visibilityLeadMinutes,
    noShowGraceMinutes: doc.noShowGraceMinutes,
    seatHoldSeconds: doc.seatHoldSeconds,
  };
}

/** The current settings. Synchronous and always safe to call — falls back to the env seed. */
export function settings(): AppSettings {
  return cache;
}

/** Prime the cache from the database, creating the singleton from the env seed if absent. */
export async function loadSettings(): Promise<AppSettings> {
  const doc = await SettingsModel.findOneAndUpdate(
    { _id: SETTINGS_ID },
    { $setOnInsert: seed },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  cache = pick(doc);
  return cache;
}

/** Persist an admin's changes and apply them to this worker immediately. */
export async function saveSettings(
  patch: Partial<AppSettings>,
  updatedBy?: string,
): Promise<AppSettings> {
  // Seed only the fields the patch does NOT set: Mongo rejects an update whose $set and
  // $setOnInsert touch the same path, which would be every save if we seeded all of them.
  const onInsert = Object.fromEntries(
    Object.entries(seed).filter(([key]) => !(key in patch)),
  );
  const doc = await SettingsModel.findOneAndUpdate(
    { _id: SETTINGS_ID },
    {
      $set: { ...patch, updatedBy: updatedBy ?? null },
      ...(Object.keys(onInsert).length > 0 ? { $setOnInsert: onInsert } : {}),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  cache = pick(doc);
  return cache;
}

/** Begin periodic re-reads so other workers' saves propagate. Idempotent. */
export function startSettingsRefresh(): void {
  if (timer) return;
  timer = setInterval(() => {
    void loadSettings().catch((err) => logger.error({ err }, '[settings] refresh failed'));
  }, REFRESH_MS);
  // Never hold the process open just for a cache refresh.
  timer.unref();
}

export function stopSettingsRefresh(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
