import { describe, it, expect } from 'vitest';
import { AuditoriumModel, MovieModel, MovieSeatModel, UnitModel, UserModel } from '../src/models/index.js';
import * as seating from '../src/modules/seating/seating.service.js';
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

  it('shows the seat as bookable on the map for that same JCO', async () => {
    const { armoured, movie } = await openSetup();
    const jco = await makeUser('9000000032', armoured._id, Rank.JCO);
    const map = await seating.getMovieSeatMap(movie.id, jco.id, Rank.JCO);
    expect(map.openToAll).toBe(true);
    expect(map.seats.every((s) => s.bookable)).toBe(true);
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
