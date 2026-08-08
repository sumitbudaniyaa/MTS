import { describe, it, expect } from 'vitest';
import {
  AdminModel,
  AuditoriumModel,
  BookingModel,
  MovieModel,
  MovieSeatModel,
  ScannerModel,
  SeatAllocationModel,
  UnitModel,
  UserModel,
} from '../src/models/index.js';
import { releaseOpenPool } from '../src/jobs/openPool.job.js';
import { openBookingWindow } from '../src/jobs/openBooking.job.js';
import { reclaimUnclaimedSeats } from '../src/jobs/reclaim.job.js';
import { setAllocations } from '../src/modules/seats/seat.service.js';
import { bookSeats, generateMovieSeats } from '../src/modules/seating/seating.service.js';
import { deleteMovie } from '../src/modules/movies/movie.service.js';
import { settings } from '../src/config/settings.js';
import { verifyTicket } from '../src/modules/attendance/attendance.service.js';
import { generateTicketCode } from '../src/utils/ids.js';
import { hashPassword } from '../src/utils/password.js';
import { BookingSource, MovieStatus, Rank, TicketStatus } from '../src/constants/enums.js';
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
      openToAll: true, // admin pressed "Open to all" — the only thing that arms the release
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

  it('leaves a movie that was never opened to all on its unit quota', async () => {
    const unit = await UnitModel.create({ name: 'Armoured', code: 'ARM' });
    const movie = await MovieModel.create({
      title: 'Restricted',
      showDate: new Date(Date.now() - 60_000),
      startTime: new Date(Date.now() - 60_000), // started: due in every respect but one
      totalSeats: 5,
      seatsBooked: 2,
      status: MovieStatus.SCHEDULED,
      // openToAll defaults to false — the admin never pressed the button.
    });
    await SeatAllocationModel.create({
      movie: movie._id,
      unit: unit._id,
      allocated: 5,
      booked: 2,
    });

    expect(await releaseOpenPool(new Date())).toBe(0);

    const fresh = await MovieModel.findById(movie._id);
    expect(fresh?.status).toBe(MovieStatus.SCHEDULED); // never reaches POOL_RELEASED
    expect(fresh?.poolSeats).toBe(0);
    expect(fresh?.poolReleasedAt).toBeNull();
    // The unit keeps its 3 unused seats.
    expect((await SeatAllocationModel.findOne({ movie: movie._id }))?.released).toBe(0);

    // Flipping the switch later arms it — the release happens on the next tick.
    await MovieModel.updateOne({ _id: movie._id }, { $set: { openToAll: true } });
    expect(await releaseOpenPool(new Date())).toBe(1);
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
    // Show is still running (default 180m duration), so it stays in the rotation and keeps
    // its bookable status — freed seats are meant to be re-sold mid-screening.
    expect(fresh?.noShowProcessedAt).toBeNull();
    expect(fresh?.status).toBe(MovieStatus.POOL_RELEASED);

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
    // Post-show sweep retires the movie so it stops being re-examined every tick, and moves
    // it to its terminal status instead of leaving it looking bookable forever.
    const retired = await MovieModel.findById(movie._id);
    expect(retired?.noShowProcessedAt).toBeTruthy();
    expect(retired?.status).toBe(MovieStatus.COMPLETED);
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

describe('booking-window open (M6)', () => {
  it('marks a movie OPEN once its window starts, and leaves the rest alone', async () => {
    const lead = settings().visibilityLeadMinutes * 60_000;

    // Window has opened (starts inside the lead) but the show has not begun.
    const opening = await MovieModel.create({
      title: 'Opening',
      showDate: new Date(Date.now() + lead / 2),
      startTime: new Date(Date.now() + lead / 2),
      totalSeats: 10,
      status: MovieStatus.SCHEDULED,
    });
    // Still well outside the window.
    const future = await MovieModel.create({
      title: 'Future',
      showDate: new Date(Date.now() + lead + 60 * 60_000),
      startTime: new Date(Date.now() + lead + 60 * 60_000),
      totalSeats: 10,
      status: MovieStatus.SCHEDULED,
    });
    // Already started — the open-pool job owns this one, not the window job.
    const started = await MovieModel.create({
      title: 'Started',
      showDate: new Date(Date.now() - 60_000),
      startTime: new Date(Date.now() - 60_000),
      totalSeats: 10,
      status: MovieStatus.SCHEDULED,
    });

    expect(await openBookingWindow(new Date())).toBe(1);
    expect((await MovieModel.findById(opening._id))?.status).toBe(MovieStatus.OPEN);
    expect((await MovieModel.findById(future._id))?.status).toBe(MovieStatus.SCHEDULED);
    expect((await MovieModel.findById(started._id))?.status).toBe(MovieStatus.SCHEDULED);

    // Idempotent — the movie is no longer SCHEDULED, so it is not picked up again.
    expect(await openBookingWindow(new Date())).toBe(0);
  });
});

describe('allocation lock at showtime', () => {
  it('refuses to re-cut quota once the show has started', async () => {
    const unit = await UnitModel.create({ name: 'Guards', code: 'GDS' });
    const startTime = new Date(Date.now() + 60 * 60_000);
    const movie = await MovieModel.create({
      title: 'Locked',
      showDate: startTime,
      startTime,
      totalSeats: 10,
      status: MovieStatus.SCHEDULED,
    });
    const allocations = { allocations: [{ unit: unit.id, allocated: 10 }] };

    // Before showtime: allowed.
    expect(await setAllocations(movie.id, allocations)).toHaveLength(1);

    // One second past showtime: refused — even though the open-pool job has not run yet and
    // the movie is still SCHEDULED, which is exactly the gap a status check would miss.
    await expect(
      setAllocations(movie.id, allocations, new Date(startTime.getTime() + 1000)),
    ).rejects.toThrow(/locked once the show has started/i);
    expect((await MovieModel.findById(movie._id))?.status).toBe(MovieStatus.SCHEDULED);
  });
});

describe('movie delete guard', () => {
  it('refuses to delete a movie that has booked tickets', async () => {
    const startTime = new Date(Date.now() + 48 * 60 * 60_000); // window not open yet
    const movie = await MovieModel.create({
      title: 'Sold',
      showDate: startTime,
      startTime,
      totalSeats: 10,
      seatsBooked: 1,
      status: MovieStatus.SCHEDULED,
    });

    await expect(deleteMovie(movie.id)).rejects.toThrow(/booked tickets/i);
    expect(await MovieModel.findById(movie._id)).not.toBeNull();

    // With no tickets against it, the same movie deletes cleanly.
    await MovieModel.updateOne({ _id: movie._id }, { $set: { seatsBooked: 0 } });
    await deleteMovie(movie.id);
    expect(await MovieModel.findById(movie._id)).toBeNull();
  });
});

describe('admin ticket verification', () => {
  it('lets an operational ADMIN check a ticket in, recorded as an Admin not a Scanner', async () => {
    const unit = await UnitModel.create({ name: 'ADMSCAN', code: 'ADS' });
    const user = await UserModel.create({
      mobile: '9000000021',
      passwordHash: await hashPassword('Pass123'),
      role: Roles.USER,
      unit: unit._id,
    });
    const admin = await AdminModel.create({
      mobile: '9000000022',
      passwordHash: await hashPassword('Pass123'),
      role: Roles.ADMIN,
      name: 'Ops Admin',
    });
    const movie = await MovieModel.create({
      title: 'AdminScan',
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
      idempotencyKey: 'k-admin-scan',
      tickets: [{ code, status: TicketStatus.BOOKED }],
    });

    const result = await verifyTicket(code, admin.id, undefined, 'Admin');
    expect(result.status).toBe(TicketStatus.CHECKED_IN);

    // `checkedInBy` is polymorphic: without the companion model field it would be read as a
    // Scanner id, populate to null, and lose who actually checked the ticket in.
    const after = await BookingModel.findOne({ movie: movie._id });
    const ticket = after!.tickets[0]!;
    expect(String(ticket.checkedInBy)).toBe(admin.id);
    expect(ticket.checkedInByModel).toBe('Admin');
  });
});

describe('open-pool release with no allocations', () => {
  it('credits the seats that are actually free, so the movie stays bookable', async () => {
    await AuditoriumModel.create({
      name: 'NoAlloc',
      rows: [{ label: 'A', seats: [1, 2, 3, 4].map((n) => ({ number: n, allowedRanks: [] })) }],
    });
    const unit = await UnitModel.create({ name: 'Solo' });
    const startTime = new Date(Date.now() - 60_000); // already started
    const movie = await MovieModel.create({
      title: 'NoAlloc',
      showDate: startTime,
      startTime,
      totalSeats: 4,
      status: MovieStatus.SCHEDULED,
      openToAll: true,
    });
    await generateMovieSeats(movie.id);
    // Allocation deliberately skipped — the whole auditorium is already common.

    expect(await releaseOpenPool(new Date())).toBe(1);
    const after = await MovieModel.findById(movie._id);
    expect(after?.status).toBe(MovieStatus.POOL_RELEASED);
    // Previously 0, which made `poolSeats` a gate that refused every booking on a movie whose
    // seats were all free.
    expect(after?.poolSeats).toBe(4);

    const user = await UserModel.create({
      mobile: '9000000092',
      passwordHash: await hashPassword('Pass123'),
      role: Roles.USER,
      unit: unit._id,
      rank: Rank.JAWAN,
      numberOfKids: 1,
    });
    const seats = await bookSeats({
      userId: user.id,
      movieId: movie.id,
      labels: ['A1'],
      idempotencyKey: 'noalloc-1',
    });
    expect(seats.length).toBe(1);
    expect((await MovieModel.findById(movie._id))?.poolSeats).toBe(3);
  });
});

describe('deleting a movie cleans up after itself', () => {
  it('removes the seat inventory and unit allocations, not just the movie', async () => {
    await AuditoriumModel.create({
      name: 'Cascade',
      rows: [{ label: 'A', seats: [1, 2, 3, 4].map((n) => ({ number: n, allowedRanks: [] })) }],
    });
    const unit = await UnitModel.create({ name: 'Cascade' });
    const startTime = new Date(Date.now() + 48 * 60 * 60_000);
    const movie = await MovieModel.create({
      title: 'Cascade', showDate: startTime, startTime, totalSeats: 4,
      status: MovieStatus.SCHEDULED,
    });
    await generateMovieSeats(movie.id);
    await setAllocations(movie.id, { allocations: [{ unit: unit.id, allocated: 4 }] });

    expect(await MovieSeatModel.countDocuments({ movie: movie._id })).toBe(4);
    expect(await SeatAllocationModel.countDocuments({ movie: movie._id })).toBe(1);

    await deleteMovie(movie.id);

    // Previously only the movie row went; its seats and allocations were left pointing at an
    // id that no longer resolves — dead rows nothing would ever show or clean up.
    expect(await MovieModel.findById(movie._id)).toBeNull();
    expect(await MovieSeatModel.countDocuments({ movie: movie._id })).toBe(0);
    expect(await SeatAllocationModel.countDocuments({ movie: movie._id })).toBe(0);
  });
});
