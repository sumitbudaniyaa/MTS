import { describe, it, expect } from 'vitest';
import { AuditoriumModel, MovieModel, MovieSeatModel, SeatAllocationModel, UnitModel, UserModel } from '../src/models/index.js';
import * as seating from '../src/modules/seating/seating.service.js';
import { setAllocations } from '../src/modules/seats/seat.service.js';
import { hashPassword } from '../src/utils/password.js';
import { Roles } from '../src/types/index.js';
import { MovieStatus, Rank, SeatStatus } from '../src/constants/enums.js';

async function setup() {
  await AuditoriumModel.create({
    name: 'Test',
    rows: [
      { label: 'A', seats: [{ number: 1, allowedRanks: [] }, { number: 2, allowedRanks: [Rank.OFFICER] }] },
    ],
  });
  const unit = await UnitModel.create({ name: 'Signals' });
  const startTime = new Date(Date.now() + 30 * 60_000); // visible
  const movie = await MovieModel.create({
    title: 'Seat Test',
    showDate: startTime,
    startTime,
    totalSeats: 2,
    status: MovieStatus.SCHEDULED,
  });
  await seating.generateMovieSeats(movie.id);
  return { unit, movie };
}

async function makeUser(mobile: string, unitId: unknown, rank = Rank.JAWAN, familyKids = 4) {
  return UserModel.create({
    mobile,
    passwordHash: await hashPassword('Pass123'),
    role: Roles.USER,
    unit: unitId,
    rank,
    numberOfKids: familyKids,
  });
}

describe('seat engine (epic)', () => {
  it('generates seats from the auditorium layout', async () => {
    const { movie } = await setup();
    const count = await MovieSeatModel.countDocuments({ movie: movie.id });
    expect(count).toBe(2);
  });

  it('never lets two users hold the same seat', async () => {
    const { unit, movie } = await setup();
    const u1 = await makeUser('9000000001', unit._id);
    const u2 = await makeUser('9000000002', unit._id);

    const results = await Promise.allSettled([
      seating.holdSeats(u1.id, movie.id, ['A1']),
      seating.holdSeats(u2.id, movie.id, ['A1']),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(1);
  });

  it('enforces the rank gate', async () => {
    const { unit, movie } = await setup();
    const jawan = await makeUser('9000000003', unit._id, Rank.JAWAN);
    // Seat A2 is Officer-only.
    await expect(seating.holdSeats(jawan.id, movie.id, ['A2'])).rejects.toMatchObject({
      statusCode: 403,
    });
    const officer = await makeUser('9000000004', unit._id, Rank.OFFICER);
    const res = await seating.holdSeats(officer.id, movie.id, ['A2']);
    expect(res.held).toEqual(['A2']);
  });

  it('books seats and marks them BOOKED with a ticket', async () => {
    const { unit, movie } = await setup();
    const user = await makeUser('9000000005', unit._id);
    const seats = await seating.bookSeats({
      userId: user.id,
      movieId: movie.id,
      labels: ['A1'],
      idempotencyKey: 'seat-key-1',
    });
    expect(seats.length).toBe(1);
    const seat = await MovieSeatModel.findOne({ movie: movie.id, label: 'A1' });
    expect(seat?.status).toBe(SeatStatus.BOOKED);
    expect(seat?.ticketCode).toBeTruthy();
  });

  it('reclaims expired holds', async () => {
    const { unit, movie } = await setup();
    const user = await makeUser('9000000006', unit._id);
    await seating.holdSeats(user.id, movie.id, ['A1']);
    // Force the hold to be in the past.
    await MovieSeatModel.updateOne(
      { movie: movie.id, label: 'A1' },
      { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
    );
    const reclaimed = await seating.releaseExpiredHolds(new Date());
    expect(reclaimed).toBe(1);
    const seat = await MovieSeatModel.findOne({ movie: movie.id, label: 'A1' });
    expect(seat?.status).toBe(SeatStatus.FREE);
  });
});

describe('open to all', () => {
  /** Auditorium whose one row is JAWAN-only, plus an open-to-all movie on it. */
  async function openSetup() {
    await AuditoriumModel.create({
      name: 'RankLocked',
      rows: [
        {
          label: 'A',
          seats: [
            { number: 1, allowedRanks: [Rank.JAWAN] },
            { number: 2, allowedRanks: [Rank.JAWAN] },
          ],
        },
      ],
    });
    const signals = await UnitModel.create({ name: 'Signals' });
    const armoured = await UnitModel.create({ name: 'Armoured' });
    const startTime = new Date(Date.now() + 30 * 60_000);
    const movie = await MovieModel.create({
      title: 'Free For All',
      showDate: startTime,
      startTime,
      totalSeats: 2,
      status: MovieStatus.SCHEDULED,
      openToAll: true,
    });
    await seating.generateMovieSeats(movie.id);
    return { signals, armoured, movie };
  }

  it('lets a JCO take a JAWAN-only seat, from any unit', async () => {
    const { armoured, movie } = await openSetup();
    // Different unit from anyone allocated the movie, and the wrong rank for the seat.
    const jco = await makeUser('9000000031', armoured._id, Rank.JCO);
    const res = await seating.holdSeats(jco.id, movie.id, ['A1']);
    expect(res.held).toEqual(['A1']);

    const booked = await seating.bookSeats({
      userId: jco.id,
      movieId: movie.id,
      labels: ['A1'],
      idempotencyKey: 'open-all-1',
    });
    expect(booked.length).toBe(1);
  });

  it('shows JAWAN seats as bookable for a JCO on the map', async () => {
    const { armoured, movie } = await openSetup();
    const jco = await makeUser('9000000032', armoured._id, Rank.JCO);
    const map = await seating.getMovieSeatMap(movie.id, jco.id, Rank.JCO);
    expect(map.openToAll).toBe(true);
    // All seats in openSetup are JAWAN-only — a JCO should see them all as bookable
    expect(map.seats.every((s) => s.bookable)).toBe(true);
  });

  it('still blocks a JCO from an OFFICER seat even when openToAll is true', async () => {
    // Re-use openSetup but add an Officer-only row to the auditorium.
    // Simplest: create a fresh auditorium with an Officer row and book against it.
    await AuditoriumModel.deleteMany({});
    await AuditoriumModel.create({
      name: 'Mixed',
      rows: [
        { label: 'A', seats: [{ number: 1, allowedRanks: [Rank.JAWAN] }] },
        { label: 'B', seats: [{ number: 1, allowedRanks: [Rank.OFFICER] }] },
      ],
    });
    const unit = await UnitModel.create({ name: 'TestUnit' });
    const startTime = new Date(Date.now() + 30 * 60_000);
    const movie = await MovieModel.create({
      title: 'Mixed Movie',
      showDate: startTime,
      startTime,
      totalSeats: 2,
      status: MovieStatus.SCHEDULED,
      openToAll: true,
    });
    await seating.generateMovieSeats(movie.id);
    const jco = await makeUser('9000000034', unit._id, Rank.JCO);
    // JCO → Jawan seat: OK
    await expect(seating.holdSeats(jco.id, movie.id, ['A1'])).resolves.toMatchObject({ held: ['A1'] });
    await seating.releaseSeats(jco.id, movie.id, ['A1']);
    // JCO → Officer seat: blocked
    await expect(seating.holdSeats(jco.id, movie.id, ['B1'])).rejects.toMatchObject({ statusCode: 403 });
  });

  it('blocks a Jawan from a JCO seat even when openToAll is true', async () => {
    await AuditoriumModel.deleteMany({});
    await AuditoriumModel.create({
      name: 'JcoOnly',
      rows: [{ label: 'A', seats: [{ number: 1, allowedRanks: [Rank.JCO] }] }],
    });
    const unit = await UnitModel.create({ name: 'TestUnit2' });
    const startTime = new Date(Date.now() + 30 * 60_000);
    const movie = await MovieModel.create({
      title: 'JCO Movie',
      showDate: startTime,
      startTime,
      totalSeats: 1,
      status: MovieStatus.SCHEDULED,
      openToAll: true,
    });
    await seating.generateMovieSeats(movie.id);
    const jawan = await makeUser('9000000035', unit._id, Rank.JAWAN);
    // Jawan → JCO seat: blocked
    await expect(seating.holdSeats(jawan.id, movie.id, ['A1'])).rejects.toMatchObject({ statusCode: 403 });
  });

  it('still blocks the wrong rank when the movie is NOT open to all', async () => {
    const { armoured, movie } = await openSetup();
    await MovieModel.updateOne({ _id: movie._id }, { $set: { openToAll: false } });
    const jco = await makeUser('9000000033', armoured._id, Rank.JCO);
    await expect(seating.holdSeats(jco.id, movie.id, ['A1'])).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});

describe('family limit at hold time', () => {
  it('refuses to hold more seats than the family size, before Confirm', async () => {
    await AuditoriumModel.create({
      name: 'Wide',
      rows: [{ label: 'A', seats: [1, 2, 3, 4, 5].map((n) => ({ number: n, allowedRanks: [] })) }],
    });
    const unit = await UnitModel.create({ name: 'Limits' });
    const startTime = new Date(Date.now() + 30 * 60_000);
    const movie = await MovieModel.create({
      title: 'Capped',
      showDate: startTime,
      startTime,
      totalSeats: 5,
      status: MovieStatus.SCHEDULED,
    });
    await seating.generateMovieSeats(movie.id);

    // familySize = 1 + 0 spouse + 1 kid = 2.
    const user = await UserModel.create({
      mobile: '9000000041',
      passwordHash: await hashPassword('Pass123'),
      role: Roles.USER,
      unit: unit._id,
      rank: Rank.JAWAN,
      numberOfKids: 1,
    });
    expect(user.familySize).toBe(2);

    // The map tells the client its cap up front, so it can stop the selection itself.
    const map = await seating.getMovieSeatMap(movie.id, user.id, Rank.JAWAN);
    expect(map.allowance).toMatchObject({ familySize: 2, booked: 0, canSelect: 2 });

    // Two seats: fine. A third: refused at HOLD, not deferred to Confirm — previously holding
    // was unlimited and tied up seats nobody else could take.
    expect((await seating.holdSeats(user.id, movie.id, ['A1'])).held).toEqual(['A1']);
    expect((await seating.holdSeats(user.id, movie.id, ['A2'])).held).toEqual(['A2']);
    await expect(seating.holdSeats(user.id, movie.id, ['A3'])).rejects.toMatchObject({
      statusCode: 400,
    });

    // Re-holding a seat they already have is not a new seat, so it must still succeed.
    expect((await seating.holdSeats(user.id, movie.id, ['A1'])).held).toEqual(['A1']);

    // Releasing one frees an allocation slot again.
    await seating.releaseSeats(user.id, movie.id, ['A2']);
    expect((await seating.holdSeats(user.id, movie.id, ['A3'])).held).toEqual(['A3']);
  });
});

describe('unit quota (reported: two people booked against a 1-seat allocation)', () => {
  async function quotaSetup(status = MovieStatus.SCHEDULED) {
    await AuditoriumModel.create({
      name: 'Quota',
      rows: [{ label: 'A', seats: [1, 2, 3, 4].map((n) => ({ number: n, allowedRanks: [] })) }],
    });
    const alpha = await UnitModel.create({ name: 'Alpha' });
    const bravo = await UnitModel.create({ name: 'Bravo' });
    const startTime = new Date(Date.now() + 30 * 60_000);
    const movie = await MovieModel.create({
      title: 'Quota', showDate: startTime, startTime, totalSeats: 4, status,
    });
    await seating.generateMovieSeats(movie.id);
    // Alpha gets exactly ONE seat; the sum must equal capacity, so Bravo takes the rest.
    await setAllocations(movie.id, {
      allocations: [
        { unit: alpha.id, allocated: 1 },
        { unit: bravo.id, allocated: 3 },
      ],
    });
    return { alpha, bravo, movie };
  }

  it('lets only ONE Alpha member book against a 1-seat allocation', async () => {
    const { alpha, movie } = await quotaSetup();
    const a = await makeUser('9000000051', alpha._id, Rank.JAWAN);
    const b = await makeUser('9000000052', alpha._id, Rank.JAWAN);

    await seating.bookSeats({ userId: a.id, movieId: movie.id, labels: ['A1'], idempotencyKey: 'q1' });
    await expect(
      seating.bookSeats({ userId: b.id, movieId: movie.id, labels: ['A2'], idempotencyKey: 'q2' }),
    ).rejects.toMatchObject({ statusCode: 409 });

    // The rejected attempt must not refund a seat it never took. It used to: the counter went
    // back to 0, so B simply tried again and got in — two people against one allocated seat.
    const alloc = await SeatAllocationModel.findOne({ movie: movie._id, unit: alpha._id });
    expect(alloc?.booked).toBe(1);

    // …which is what makes the retry stay rejected.
    await expect(
      seating.bookSeats({ userId: b.id, movieId: movie.id, labels: ['A2'], idempotencyKey: 'q2b' }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      (await SeatAllocationModel.findOne({ movie: movie._id, unit: alpha._id }))?.booked,
    ).toBe(1);
  });

  it('bypasses the quota once the pool has been released — by design', async () => {
    const { alpha, movie } = await quotaSetup(MovieStatus.POOL_RELEASED);
    await MovieModel.updateOne({ _id: movie._id }, { $set: { poolSeats: 4 } });
    const a = await makeUser('9000000053', alpha._id, Rank.JAWAN);
    const b = await makeUser('9000000054', alpha._id, Rank.JAWAN);

    await seating.bookSeats({ userId: a.id, movieId: movie.id, labels: ['A1'], idempotencyKey: 'q3' });
    await seating.bookSeats({ userId: b.id, movieId: movie.id, labels: ['A2'], idempotencyKey: 'q4' });

    // Both succeed, and the unit's `booked` counter never moves — the seats came from the pool.
    const alloc = await SeatAllocationModel.findOne({ movie: movie._id, unit: alpha._id });
    expect(alloc?.booked).toBe(0);
  });
});

describe('unit quota shapes the picker cap', () => {
  async function setup(alphaBooked: number, kids = 2, status = MovieStatus.SCHEDULED) {
    await AuditoriumModel.create({
      name: 'Cap',
      rows: [{ label: 'A', seats: [1, 2, 3, 4, 5, 6].map((n) => ({ number: n, allowedRanks: [] })) }],
    });
    const alpha = await UnitModel.create({ name: 'Alpha' });
    const bravo = await UnitModel.create({ name: 'Bravo' });
    const st = new Date(Date.now() + 30 * 60_000);
    const movie = await MovieModel.create({
      title: 'Cap', showDate: st, startTime: st, totalSeats: 6, status,
    });
    await seating.generateMovieSeats(movie.id);
    await setAllocations(movie.id, {
      allocations: [{ unit: alpha.id, allocated: 4 }, { unit: bravo.id, allocated: 2 }],
    });
    await SeatAllocationModel.updateOne(
      { movie: movie._id, unit: alpha._id },
      { $set: { booked: alphaBooked } },
    );
    // familySize = self + spouse + kids
    const user = await UserModel.create({
      mobile: `90000000${80 + alphaBooked}`,
      passwordHash: await hashPassword('Pass123'),
      role: Roles.USER, unit: alpha._id, rank: Rank.JAWAN,
      maritalStatus: 'MARRIED', numberOfKids: kids,
    });
    return { alpha, movie, user };
  }

  it('caps a family of 4 at the ONE seat their unit has left', async () => {
    const { movie, user } = await setup(3);
    expect(user.familySize).toBe(4);

    const map = await seating.getMovieSeatMap(movie.id, user.id, Rank.JAWAN);
    // The cap is the unit's 1, not the family's 4 — so the picker can't offer a doomed pick.
    expect(map.allowance).toMatchObject({ familySize: 4, canSelect: 1, unitRemaining: 1 });

    // Holding a second seat is refused up front, and says which limit bit and the real number.
    expect((await seating.holdSeats(user.id, movie.id, ['A1'])).held).toEqual(['A1']);
    await expect(seating.holdSeats(user.id, movie.id, ['A2'])).rejects.toMatchObject({
      statusCode: 400,
      // They hold the unit's only seat, so the honest message is the TOTAL they may hold.
      message: 'Your unit allows 1 seat(s) for this show',
    });
  });

  it('reports zero and names the unit when the allocation is spent', async () => {
    const { movie, user } = await setup(4);
    const map = await seating.getMovieSeatMap(movie.id, user.id, Rank.JAWAN);
    expect(map.allowance).toMatchObject({ canSelect: 0, unitRemaining: 0 });
    await expect(seating.holdSeats(user.id, movie.id, ['A1'])).rejects.toMatchObject({
      message: 'No seats left for your unit for this movie',
    });
  });

  it('ignores unit quota once the pool is released', async () => {
    const { movie, user } = await setup(4, 2, MovieStatus.POOL_RELEASED);
    const map = await seating.getMovieSeatMap(movie.id, user.id, Rank.JAWAN);
    // Quota is dissolved, so the family limit is the only cap again.
    expect(map.allowance).toMatchObject({ canSelect: 4, unitRemaining: null });
    expect((await seating.holdSeats(user.id, movie.id, ['A1'])).held).toEqual(['A1']);
  });
});

describe('open to all takes effect immediately, before any pool release', () => {
  it('dissolves unit quota the moment the flag is set — no waiting for showtime', async () => {
    await AuditoriumModel.create({
      name: 'Now',
      rows: [{ label: 'A', seats: [1, 2, 3, 4].map((n) => ({ number: n, allowedRanks: [] })) }],
    });
    const alpha = await UnitModel.create({ name: 'Alpha' });
    const bravo = await UnitModel.create({ name: 'Bravo' });
    const st = new Date(Date.now() + 30 * 60_000); // show has NOT started
    const movie = await MovieModel.create({
      title: 'Now', showDate: st, startTime: st, totalSeats: 4, status: MovieStatus.SCHEDULED,
    });
    await seating.generateMovieSeats(movie.id);
    await setAllocations(movie.id, {
      allocations: [{ unit: alpha.id, allocated: 2 }, { unit: bravo.id, allocated: 2 }],
    });
    // Alpha's 2 seats are gone.
    await SeatAllocationModel.updateOne(
      { movie: movie._id, unit: alpha._id },
      { $set: { booked: 2 } },
    );
    const user = await makeUser('9000000101', alpha._id, Rank.JAWAN);

    // Before the button: Alpha is locked out.
    let map = await seating.getMovieSeatMap(movie.id, user.id, Rank.JAWAN);
    expect(map.allowance).toMatchObject({ canSelect: 0, unitRemaining: 0 });
    await expect(seating.holdSeats(user.id, movie.id, ['A1'])).rejects.toMatchObject({
      message: 'No seats left for your unit for this movie',
    });

    // Admin clicks "Open to all". The show still hasn't started and nothing has been released.
    await seating.setMovieOpenToAll(movie.id, true);
    const still = await MovieModel.findById(movie._id);
    expect(still?.status).toBe(MovieStatus.SCHEDULED); // no pool release yet
    expect(still?.poolSeats).toBe(0);

    // …yet the same person can book right now, quota ignored.
    map = await seating.getMovieSeatMap(movie.id, user.id, Rank.JAWAN);
    expect(map.allowance).toMatchObject({ unitRemaining: null });
    expect(map.allowance!.canSelect).toBeGreaterThan(0);
    expect((await seating.holdSeats(user.id, movie.id, ['A1'])).held).toEqual(['A1']);
    const seats = await seating.bookSeats({
      userId: user.id, movieId: movie.id, labels: ['A1'], idempotencyKey: 'now-1',
    });
    expect(seats.length).toBe(1);

    // Alpha's counter is untouched — the seat came from the pool, not their allocation.
    expect(
      (await SeatAllocationModel.findOne({ movie: movie._id, unit: alpha._id }))?.booked,
    ).toBe(2);
  });

  it('a JCO can take a Jawan seat immediately too, from another unit', async () => {
    await AuditoriumModel.create({
      name: 'NowRank',
      rows: [{ label: 'A', seats: [{ number: 1, allowedRanks: [Rank.JAWAN] }] }],
    });
    const alpha = await UnitModel.create({ name: 'Alpha' });
    const st = new Date(Date.now() + 30 * 60_000);
    const movie = await MovieModel.create({
      title: 'NowRank', showDate: st, startTime: st, totalSeats: 1, status: MovieStatus.SCHEDULED,
    });
    await seating.generateMovieSeats(movie.id);
    const jco = await makeUser('9000000102', alpha._id, Rank.JCO);

    await expect(seating.holdSeats(jco.id, movie.id, ['A1'])).rejects.toMatchObject({
      statusCode: 403,
    });
    await seating.setMovieOpenToAll(movie.id, true);
    expect((await seating.holdSeats(jco.id, movie.id, ['A1'])).held).toEqual(['A1']);
  });
});

describe('opening the pool is one-way', () => {
  it('refuses to close a pool that has been opened', async () => {
    await AuditoriumModel.create({
      name: 'OneWay',
      rows: [{ label: 'A', seats: [{ number: 1, allowedRanks: [] }] }],
    });
    const st = new Date(Date.now() + 30 * 60_000);
    const movie = await MovieModel.create({
      title: 'OneWay', showDate: st, startTime: st, totalSeats: 1,
      status: MovieStatus.SCHEDULED,
    });
    await seating.generateMovieSeats(movie.id);

    expect(await seating.setMovieOpenToAll(movie.id, true)).toBe(true);
    // Closing it would snap unit quota back over bookings that no allocation counted, leaving
    // units with headroom they had already spent.
    await expect(seating.setMovieOpenToAll(movie.id, false)).rejects.toMatchObject({
      statusCode: 409,
      message: 'The pool cannot be closed once it has been opened',
    });
    expect((await MovieModel.findById(movie._id))?.openToAll).toBe(true);

    // Re-opening an already-open pool is a harmless no-op, not an error.
    expect(await seating.setMovieOpenToAll(movie.id, true)).toBe(true);
  });
});

describe('per-unit figures once the pool is open', () => {
  it('counts what a unit actually holds, above its allocation', async () => {
    await AuditoriumModel.create({
      name: 'OverQuota',
      rows: [{ label: 'A', seats: [1, 2, 3, 4].map((n) => ({ number: n, allowedRanks: [] })) }],
    });
    const alpha = await UnitModel.create({ name: 'Alpha' });
    const bravo = await UnitModel.create({ name: 'Bravo' });
    const st = new Date(Date.now() + 30 * 60_000);
    const movie = await MovieModel.create({
      title: 'OverQuota', showDate: st, startTime: st, totalSeats: 4,
      status: MovieStatus.SCHEDULED,
    });
    await seating.generateMovieSeats(movie.id);
    // Alpha is allocated ONE seat.
    await setAllocations(movie.id, {
      allocations: [{ unit: alpha.id, allocated: 1 }, { unit: bravo.id, allocated: 3 }],
    });

    const u = await makeUser('9000000111', alpha._id, Rank.JAWAN, 4);
    await seating.bookSeats({
      userId: u.id, movieId: movie.id, labels: ['A1'], idempotencyKey: 'oq-1',
    });

    // Pool opens; the same person takes two more — quota no longer applies.
    await seating.setMovieOpenToAll(movie.id, true);
    await seating.bookSeats({
      userId: u.id, movieId: movie.id, labels: ['A2', 'A3'], idempotencyKey: 'oq-2',
    });

    const detail = await seating.getMovieAdminDetail(movie.id);
    const row = detail.allocations.find((a) => a.unit === 'Alpha')!;
    // The quota counter froze at 1 when the pool opened…
    expect(row.quotaUsed).toBe(1);
    // …but Alpha is holding three seats, which is what the table must show.
    expect(row.booked).toBe(3);
    expect(row.allocated).toBe(1);
    expect(row.overQuota).toBe(2);
    expect(row.remaining).toBe(0);
  });
});
