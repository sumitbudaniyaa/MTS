import cron, { type ScheduledTask } from 'node-cron';
import { releaseOpenPool } from './openPool.job.js';
import { reclaimUnclaimedSeats } from './reclaim.job.js';
import { releaseExpiredHolds } from '../modules/seating/seating.service.js';
import { logger } from '../config/logger.js';

let task: ScheduledTask | null = null;
let holdTask: ScheduledTask | null = null;
let running = false;

/**
 * Runs both reconciliation jobs once. Serialized via a guard so overlapping ticks never
 * run the jobs concurrently. Exposed for tests and manual triggers.
 */
export async function runDueJobs(now: Date = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const releasedPools = await releaseOpenPool(now);
    const reclaimed = await reclaimUnclaimedSeats(now);
    if (releasedPools || reclaimed) {
      logger.info({ releasedPools, reclaimed }, '[scheduler] tick complete');
    }
  } finally {
    running = false;
  }
}

/** Start the cron schedulers. Idempotent. Open-pool/seat-reclaim run per minute; seat-hold
 * expiry runs every 20s so released seats reappear quickly on the live map. */
export function startScheduler(): void {
  if (task) return;
  task = cron.schedule('* * * * *', () => {
    void runDueJobs().catch((err) => logger.error({ err }, '[scheduler] tick failed'));
  });
  holdTask = cron.schedule('*/20 * * * * *', () => {
    void releaseExpiredHolds().catch((err) => logger.error({ err }, '[scheduler] hold tick failed'));
  });
  logger.info('[scheduler] started (jobs/min, holds/20s)');
}

export function stopScheduler(): void {
  task?.stop();
  holdTask?.stop();
  task = null;
  holdTask = null;
}
