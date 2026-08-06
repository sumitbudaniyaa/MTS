import { describe, it, expect } from 'vitest';
import {
  BookingModel,
  MovieModel,
  ScannerModel,
  SeatAllocationModel,
  UnitModel,
  UserModel,
} from '../src/models/index.js';
import { releaseOpenPool } from '../src/jobs/openPool.job.js';
import { reclaimUnclaimedSeats } from '../src/jobs/reclaim.job.js';
import { verifyTicket } from '../src/modules/attendance/attendance.service.js';
import { generateTicketCode } from '../src/utils/ids.js';
import { hashPassword } from '../src/utils/password.js';
import { BookingSource, MovieStatus, TicketStatus } from '../src/constants/enums.js';
import { Roles } from '../src/types/index.js';

describe('open-pool release (M6)', () => {
  it('moves unused unit quota into the common pool; idempotent', async () => {
    const unit = await UnitModel.create({ name: 'Signals', code: 'SIG' });
    const movie = await MovieModel.create({
      title: 'Pool',
      showDate: new Date(Date.now() - 60_000),
      startTime: new Date(Date.now() - 60_000), // already started -> due
      totalSeats: 5,
      seatsBooked: 2,
      status: MovieStatus.SCHEDULED,
    });
    await SeatAllocationModel.create({
      movie: movie._id,
      unit: unit._id,
      allocated: 5,
      booked: 2, // 3 unused -> should be released
    });

    const released = await releaseOpenPool(new Date());
    expect(released).toBe(1);

    const fresh = await MovieModel.findById(movie._id);
    expect(fresh?.status).toBe(MovieStatus.POOL_RELEASED);
    expect(fresh?.poolSeats).toBe(3);
    expect(fresh?.poolReleasedAt).toBeTruthy();
    const alloc = await SeatAllocationModel.findOne({ movie: movie._id });
    expect(alloc?.released).toBe(3);

    // Idempotent — second run does nothing.
    const again = await releaseOpenPool(new Date());
    expect(again).toBe(0);
    expect((await MovieModel.findById(movie._id))?.poolSeats).toBe(3);
  });
});

/**
 * Force a booking's createdAt, which is what decides advance-booking vs walk-in. Goes through
 * the raw driver: Mongoose manages `createdAt` itself and drops it from a normal update.
 */
async function setBookedAt(bookingId: unknown, at: Date): Promise<void> {
  await BookingModel.collection.updateOne(
    { _id: bookingId as never },
    { $set: { createdAt: at } },
  );
}

describe('seat reclaim (M6)', () => {
  it('expires advance bookings after grace and returns seats to the pool', async () => {
    const unit = await UnitModel.create({ name: 'ASC', code: 'ASC' });
    const user = await UserModel.create({
      mobile: '9000000001',
      passwordHash: await hashPassword('Pass123'),
      role: Roles.USER,
      unit: unit._id,
    });
    const startedAt = new Date(Date.now() - 30 * 60_000); // 30m ago > 15m grace
    const movie = await MovieModel.create({
      title: 'NoShow',
      showDate: startedAt,
      startTime: startedAt,
      totalSeats: 3,
      seatsBooked: 3,
      status: MovieStatus.POOL_RELEASED,
    });
    const booking = await BookingModel.create({
      user: user._id,
      movie: movie._id,
      unit: unit._id,
      source: BookingSource.UNIT_QUOTA,
      quantity: 3,
      idempotencyKey: 'k1',
      tickets: [
        { code: generateTicketCode(), status: TicketStatus.BOOKED },
        { code: generateTicketCode(), status: TicketStatus.BOOKED },
        // One already checked in — must NOT be reclaimed.
        { code: generateTicketCode(), status: TicketStatus.CHECKED_IN, checkedIn: true },
      ],
    });
    // Reserved a day before the show — the cohort a no-show actually means something for.
    await setBookedAt(booking._id, new Date(startedAt.getTime() - 86_400_000));

    const reclaimed = await reclaimUnclaimedSeats(new Date());
    expect(reclaimed).toBe(2);

    const fresh = await MovieModel.findById(movie._id);
    expect(fresh?.seatsBooked).toBe(1); // 3 - 2 reclaimed
    expect(fresh?.poolSeats).toBe(2); // 2 returned to pool
    // Show is still running (default 180m duration), so it stays in the rotation.
    expect(fresh?.noShowProcessedAt).toBeNull();

    const after = await BookingModel.findOne({ movie: movie._id });
    const statuses = after?.tickets.map((t) => t.status).sort();
    expect(statuses).toEqual([
      TicketStatus.CHECKED_IN,
      TicketStatus.EXPIRED,
      TicketStatus.EXPIRED,
    ]);

    // Idempotent.
    expect(await reclaimUnclaimedSeats(new Date())).toBe(0);
  });

  it('gives a mid-show walk-in its own grace, then RELEASES rather than counting a no-show', async () => {
    const unit = await UnitModel.create({ name: 'RAJ', code: 'RAJ' });
    const user = await UserModel.create({
      mobile: '9000000009',
      passwordHash: await hashPassword('Pass123'),
      role: Roles.USER,
      unit: unit._id,
    });
    const startedAt = new Date(Date.now() - 60 * 60_000); // started an hour ago
    const movie = await MovieModel.create({
      title: 'WalkIn',
      showDate: startedAt,
      startTime: startedAt,
      durationMinutes: 180,
      totalSeats: 1,
      seatsBooked: 1,
      status: MovieStatus.POOL_RELEASED,
    });
    const bookedAt = new Date(Date.now() - 60_000); // grabbed a freed seat a minute ago
    const booking = await BookingModel.create({
      user: user._id,
      movie: movie._id,
      unit: unit._id,
      source: BookingSource.OPEN_POOL,
      quantity: 1,
      idempotencyKey: 'k9',
      tickets: [{ code: generateTicketCode(), status: TicketStatus.BOOKED }],
    });
    await setBookedAt(booking._id, bookedAt);

    // Their 15 minutes run from the booking, not from showtime — so nothing yet, even though
    // the movie started long ago. Under the old per-movie sweep this seat was reclaimed
    // instantly (or, once the sweep had run, never at all).
    expect(await reclaimUnclaimedSeats(new Date())).toBe(0);

    // Once their own grace elapses the seat comes back…
    const later = new Date(bookedAt.getTime() + 16 * 60_000);
    expect(await reclaimUnclaimedSeats(later)).toBe(1);

    const after = await BookingModel.findOne({ movie: movie._id });
    // …as RELEASED, so it never inflates the no-show figure.
    expect(after?.tickets[0]?.status).toBe(TicketStatus.RELEASED);
  });

  it('caps every deadline at the end of the show and then retires the movie', async () => {
    const unit = await UnitModel.create({ name: 'GRD', code: 'GRD' });
    const user = await UserModel.create({
      mobile: '9000000010',
      passwordHash: await hashPassword('Pass123'),
      role: Roles.USER,
      unit: unit._id,
    });
    const startedAt = new Date(Date.now() - 120 * 60_000);
    const movie = await MovieModel.create({
      title: 'Ended',
      showDate: startedAt,
      startTime: startedAt,
      durationMinutes: 60, // ended an hour ago
      totalSeats: 1,
      seatsBooked: 1,
      status: MovieStatus.POOL_RELEASED,
    });
    // Booked 5 minutes before the end: a naive bookedAt + 15m deadline would fall AFTER the
    // show finished, leaving the ticket unresolved once the report became available.
    const booking = await BookingModel.create({
      user: user._id,
      movie: movie._id,
      unit: unit._id,
      source: BookingSource.OPEN_POOL,
      quantity: 1,
      idempotencyKey: 'k10',
      tickets: [{ code: generateTicketCode(), status: TicketStatus.BOOKED }],
    });
    await setBookedAt(booking._id, new Date(startedAt.getTime() + 55 * 60_000));

    expect(await reclaimUnclaimedSeats(new Date())).toBe(1);

    const after = await BookingModel.findOne({ movie: movie._id });
    expect(after?.tickets[0]?.status).toBe(TicketStatus.RELEASED);
    // Post-show sweep retires the movie so it stops being re-examined every tick.
    expect((await MovieModel.findById(movie._id))?.noShowProcessedAt).toBeTruthy();
  });
});

describe('ticket verification (M6)', () => {
  it('checks in a BOOKED ticket once, rejects re-scan and unknown codes', async () => {
    const unit = await UnitModel.create({ name: 'EME', code: 'EME' });
    const user = await UserModel.create({
      mobile: '9000000002',
      passwordHash: await hashPassword('Pass123'),
      role: Roles.USER,
      unit: unit._id,
    });
    const scanner = await ScannerModel.create({
      mobile: '9000000003',
      passwordHash: await hashPassword('Pass123'),
    });
    const movie = await MovieModel.create({
      title: 'Verify',
      showDate: new Date(),
      startTime: new Date(),
      totalSeats: 1,
      seatsBooked: 1,
      status: MovieStatus.OPEN,
    });
    const code = generateTicketCode();
    await BookingModel.create({
      user: user._id,
      movie: movie._id,
      unit: unit._id,
      source: BookingSource.UNIT_QUOTA,
      quantity: 1,
      idempotencyKey: 'k2',
      tickets: [{ code, status: TicketStatus.BOOKED }],
    });

    const result = await verifyTicket(code, scanner.id);
    expect(result.status).toBe(TicketStatus.CHECKED_IN);
    expect(result.holderMobile).toBe('9000000002');

    // Re-scan -> conflict.
    await expect(verifyTicket(code, scanner.id)).rejects.toMatchObject({ statusCode: 409 });

    // Unknown code -> 404.
    await expect(verifyTicket('TKT-UNKNOWN', scanner.id)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
