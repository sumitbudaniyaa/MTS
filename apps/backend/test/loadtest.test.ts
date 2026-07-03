import { describe, it, expect } from 'vitest';
import {
  AuditoriumModel,
  MovieModel,
  MovieSeatModel,
  UnitModel,
  UserModel,
} from '../src/models/index.js';
import * as seating from '../src/modules/seating/seating.service.js';
import { hashPassword } from '../src/utils/password.js';
import { Roles } from '../src/types/index.js';
import { MovieStatus, SeatStatus } from '../src/constants/enums.js';

/**
 * Throughput / concurrency benchmark for the seat-booking engine. Exercises the REAL
 * `bookSeats` service against an in-memory MongoDB replica set. Numbers are relative (a
 * single-node in-memory mongod on this machine, not production Atlas), but they validate:
 *   - the atomic FREE/own-HELD -> BOOKED claim never oversells under heavy contention, and
 *   - the sustained bookings/sec the code path can push.
 * Run explicitly:  npx vitest run test/loadtest.test.ts
 */

async function buildHall(rows: number, perRow: number) {
  // Fixed-width row labels so `${row}${number}` labels never collide (R1+11 vs R11+1).
  const layout = Array.from({ length: rows }, (_, r) => ({
    label: `R${String(r).padStart(3, '0')}`,
    seats: Array.from({ length: perRow }, (_, s) => ({ number: s + 1, allowedRanks: [] })),
  }));
  await AuditoriumModel.create({ name: 'Load', rows: layout });
  const unit = await UnitModel.create({ name: 'Load Unit' });
  const startTime = new Date(Date.now() + 30 * 60_000); // inside booking window
  const movie = await MovieModel.create({
    title: 'Load',
    showDate: startTime,
    startTime,
    durationMinutes: 180,
    totalSeats: rows * perRow,
    status: MovieStatus.SCHEDULED,
  });
  await seating.generateMovieSeats(movie.id);
  const labels = layout.flatMap((row) => row.seats.map((s) => `${row.label}${s.number}`));
  return { unit, movie, labels };
}

async function makeUsers(n: number, unitId: unknown, kids = 6) {
  const hash = await hashPassword('Pass123'); // hash once — bcrypt isn't what we're measuring
  const docs = Array.from({ length: n }, (_, i) => ({
    mobile: String(7_000_000_000 + i),
    passwordHash: hash,
    role: Roles.USER,
    unit: unitId,
    numberOfKids: kids,
  }));
  return UserModel.insertMany(docs);
}

describe('booking throughput & contention', () => {
  it('NO-CONTENTION: each user books a distinct seat concurrently — measures bookings/sec', async () => {
    const ROWS = 40;
    const PER_ROW = 25; // 1,000 seats
    const { unit, movie, labels } = await buildHall(ROWS, PER_ROW);
    const users = await makeUsers(labels.length, unit._id);

    const t0 = Date.now();
    const results = await Promise.allSettled(
      users.map((u, i) =>
        seating.bookSeats({
          userId: u.id,
          movieId: movie.id,
          labels: [labels[i]!],
          idempotencyKey: `k-${i}`,
        }),
      ),
    );
    const ms = Date.now() - t0;

    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const bookedSeats = await MovieSeatModel.countDocuments({
      movie: movie.id,
      status: SeatStatus.BOOKED,
    });
    const perSec = Math.round((ok / ms) * 1000);

    // eslint-disable-next-line no-console
    console.log(
      `\n[LOAD] no-contention: ${ok}/${labels.length} bookings in ${ms}ms  →  ~${perSec} bookings/sec` +
        `  (${bookedSeats} seats BOOKED, 0 oversell)`,
    );

    expect(ok).toBe(labels.length);
    expect(bookedSeats).toBe(labels.length); // exactly full, none double-claimed
  });

  it('HIGH-CONTENTION: 300 users stampede the same 10 seats — exactly 10 win, no oversell', async () => {
    const { unit, movie, labels } = await buildHall(1, 10); // 10 seats
    const users = await makeUsers(300, unit._id);

    const t0 = Date.now();
    const results = await Promise.allSettled(
      users.map((u, i) =>
        seating.bookSeats({
          userId: u.id,
          movieId: movie.id,
          labels: [labels[i % labels.length]!], // everyone fights over the same 10
          idempotencyKey: `c-${i}`,
        }),
      ),
    );
    const ms = Date.now() - t0;

    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const bookedSeats = await MovieSeatModel.countDocuments({
      movie: movie.id,
      status: SeatStatus.BOOKED,
    });

    // eslint-disable-next-line no-console
    console.log(
      `\n[LOAD] high-contention: ${users.length} concurrent attempts on ${labels.length} seats resolved in ${ms}ms  →  ${ok} succeeded, ${users.length - ok} cleanly rejected (0 oversell)`,
    );

    expect(bookedSeats).toBe(labels.length); // every seat sold exactly once
    expect(ok).toBe(labels.length); // winners == seats, never more
  });
});
