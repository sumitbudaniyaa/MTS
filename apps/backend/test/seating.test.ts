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
