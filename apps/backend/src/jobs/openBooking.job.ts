import { MovieModel } from '../models/index.js';
import { MovieStatus } from '../constants/enums.js';
import { settings } from '../config/settings.js';
import { logger } from '../config/logger.js';
import { broadcastMovie } from '../realtime/gateway.js';

/**
 * Marks a movie OPEN once its booking window starts (`startTime - visibilityLeadMinutes`),
 * so a show that is actively taking bookings stops being listed as merely SCHEDULED.
 *
 * This is a display concern only. Whether a seat can actually be booked is decided per
 * request by `isMovieVisible` against the clock, so a movie whose window has opened is
 * bookable immediately — this job does not grant that, it only reports it. Keeping the two
 * in step is why the window is read from `settings()` here rather than hardcoded: the lead
 * is admin-tunable at runtime.
 *
 * Movies already past `startTime` are left alone — the open-pool job owns that transition,
 * and it runs first on each tick.
 *
 * @returns number of movies opened this run.
 */
export async function openBookingWindow(now: Date = new Date()): Promise<number> {
  const lead = settings().visibilityLeadMinutes * 60_000;
  const filter = {
    status: MovieStatus.SCHEDULED,
    // Window has started (startTime - lead <= now) but the show has not.
    startTime: { $lte: new Date(now.getTime() + lead), $gt: now },
  };

  // Ids first, so the admin consoles can be told exactly which rows moved.
  const due = await MovieModel.find(filter).select('_id');
  if (due.length === 0) return 0;

  const res = await MovieModel.updateMany(filter, { $set: { status: MovieStatus.OPEN } });

  const opened = res.modifiedCount;
  if (opened > 0) {
    for (const { _id } of due) broadcastMovie(String(_id), { status: MovieStatus.OPEN });
    logger.info({ opened }, '[job] booking window opened');
  }
  return opened;
}
