import { describe, it, expect } from 'vitest';
import {
  BookingModel,
  MovieModel,
  SeatAllocationModel,
  UnitModel,
  UserModel,
} from '../src/models/index.js';
import { createBooking } from '../src/modules/bookings/booking.service.js';
import { hashPassword } from '../src/utils/password.js';
import { MovieStatus, Rank } from '../src/constants/enums.js';
import { Roles } from '../src/types/index.js';

/** Seed a unit + a SCHEDULED, currently-visible movie with a single-unit allocation. */
async function seedScenario(opts: { totalSeats: number; allocated: number }) {
  const unit = await UnitModel.create({ name: 'Signals', code: 'SIG' });
  const startTime = new Date(Date.now() + 30 * 60_000); // visible (within 1h window)
  const movie = await MovieModel.create({
    title: 'Concurrency Test',
    showDate: startTime,
    startTime,
    totalSeats: opts.totalSeats,
    status: MovieStatus.SCHEDULED,
  });
  await SeatAllocationModel.create({
    movie: movie._id,
    unit: unit._id,
    rank: Rank.JAWAN,
    allocated: opts.allocated,
  });
  return { unit, movie };
}

async function makeUser(mobile: string, unitId: unknown, familySize = 1) {
  // Use kids to raise familySize deterministically (1 self + kids).
  return UserModel.create({
    mobile,
    passwordHash: await hashPassword('Pass123'),
    role: Roles.USER,
    unit: unitId,
    numberOfKids: Math.max(0, familySize - 1),
  });
}

describe('booking engine (M5)', () => {
  it('never oversells: 10 concurrent users, only 2 seats', async () => {
    const { unit, movie } = await seedScenario({ totalSeats: 2, allocated: 2 });

    const users = await Promise.all(
      Array.from({ length: 10 }, (_, i) => makeUser(`90000000${10 + i}`, unit._id)),
    );

    // Fire all 10 bookings concurrently, each requesting 1 seat.
    const results = await Promise.allSettled(
      users.map((u, i) =>
        createBooking({
          userId: u.id,
          unitId: String(unit._id),
          movieId: String(movie._id),
          quantity: 1,
          idempotencyKey: `key-${i}`,
        }),
      ),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    expect(succeeded).toBe(2);

    // Persisted seat counts must be exactly at capacity — no oversell.
    const freshMovie = await MovieModel.findById(movie._id);
    const alloc = await SeatAllocationModel.findOne({ movie: movie._id, unit: unit._id });
    expect(freshMovie?.seatsBooked).toBe(2);
    expect(alloc?.booked).toBe(2);

    const ticketCount = await BookingModel.aggregate([
      { $match: { movie: movie._id } },
      { $unwind: '$tickets' },
      { $count: 'n' },
    ]);
    expect(ticketCount[0]?.n ?? 0).toBe(2);
  });

  it('is idempotent: same key concurrently creates exactly one booking', async () => {
    const { unit, movie } = await seedScenario({ totalSeats: 5, allocated: 5 });
    const user = await makeUser('9000000099', unit._id, 3);

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        createBooking({
          userId: user.id,
          unitId: String(unit._id),
          movieId: String(movie._id),
          quantity: 2,
          idempotencyKey: 'same-key',
        }),
      ),
    );

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<{ id: string }> => r.status === 'fulfilled',
    );
    // Every successful call resolves to the same single booking.
    const ids = new Set(fulfilled.map((r) => r.value.id));
    expect(ids.size).toBe(1);

    const bookings = await BookingModel.countDocuments({ user: user.id, movie: movie._id });
    expect(bookings).toBe(1);

    // Seats decremented exactly once (2), not 5x2.
    const alloc = await SeatAllocationModel.findOne({ movie: movie._id, unit: unit._id });
    expect(alloc?.booked).toBe(2);
  });

  it('enforces the family-size limit', async () => {
    const { unit, movie } = await seedScenario({ totalSeats: 10, allocated: 10 });
    const user = await makeUser('9000000077', unit._id, 2); // familySize = 2

    // Requesting 3 with a family limit of 2 must fail.
    await expect(
      createBooking({
        userId: user.id,
        unitId: String(unit._id),
        movieId: String(movie._id),
        quantity: 3,
        idempotencyKey: 'fam-1',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    // Two is allowed.
    const ok = await createBooking({
      userId: user.id,
      unitId: String(unit._id),
      movieId: String(movie._id),
      quantity: 2,
      idempotencyKey: 'fam-2',
    });
    expect(ok.quantity).toBe(2);
  });

  it('blocks booking more seats than the unit quota allows', async () => {
    // Unit gets only 1 seat allocated, but user's familySize is 4.
    // The unit quota is the binding constraint — only 1 should succeed.
    const { unit, movie } = await seedScenario({ totalSeats: 10, allocated: 1 });
    const user = await makeUser('9000000088', unit._id, 4); // familySize = 4

    // Trying to book 2 must fail (only 1 allocated to the unit).
    await expect(
      createBooking({
        userId: user.id,
        unitId: String(unit._id),
        movieId: String(movie._id),
        quantity: 2,
        idempotencyKey: 'quota-over',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    // Booking exactly 1 must succeed.
    const ok = await createBooking({
      userId: user.id,
      unitId: String(unit._id),
      movieId: String(movie._id),
      quantity: 1,
      idempotencyKey: 'quota-ok',
    });
    expect(ok.quantity).toBe(1);

    // After the 1 seat is taken, a second user from the same unit must be blocked.
    const user2 = await makeUser('9000000089', unit._id, 4);
    await expect(
      createBooking({
        userId: user2.id,
        unitId: String(unit._id),
        movieId: String(movie._id),
        quantity: 1,
        idempotencyKey: 'quota-exhausted',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
