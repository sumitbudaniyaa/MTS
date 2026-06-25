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
import { expireNoShows } from '../src/jobs/noShow.job.js';
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

describe('no-show expiry (M6)', () => {
  it('expires un-checked-in tickets after grace and returns seats to pool', async () => {
    const unit = await UnitModel.create({ name: 'ASC', code: 'ASC' });
    const user = await UserModel.create({
      mobile: '9000000001',
      passwordHash: await hashPassword('Pass123'),
      role: Roles.USER,
      unit: unit._id,
    });
    const movie = await MovieModel.create({
      title: 'NoShow',
      showDate: new Date(Date.now() - 30 * 60_000),
      startTime: new Date(Date.now() - 30 * 60_000), // 30m ago > 15m grace
      totalSeats: 3,
      seatsBooked: 3,
      status: MovieStatus.POOL_RELEASED,
    });
    await BookingModel.create({
      user: user._id,
      movie: movie._id,
      unit: unit._id,
      source: BookingSource.UNIT_QUOTA,
      quantity: 3,
      idempotencyKey: 'k1',
      tickets: [
        { code: generateTicketCode(), status: TicketStatus.BOOKED },
        { code: generateTicketCode(), status: TicketStatus.BOOKED },
        // One already checked in — must NOT be expired.
        { code: generateTicketCode(), status: TicketStatus.CHECKED_IN, checkedIn: true },
      ],
    });

    const expired = await expireNoShows(new Date());
    expect(expired).toBe(2);

    const fresh = await MovieModel.findById(movie._id);
    expect(fresh?.seatsBooked).toBe(1); // 3 - 2 expired
    expect(fresh?.poolSeats).toBe(2); // 2 returned to pool
    expect(fresh?.noShowProcessedAt).toBeTruthy();

    const booking = await BookingModel.findOne({ movie: movie._id });
    const statuses = booking?.tickets.map((t) => t.status).sort();
    expect(statuses).toEqual([
      TicketStatus.CHECKED_IN,
      TicketStatus.EXPIRED,
      TicketStatus.EXPIRED,
    ]);

    // Idempotent.
    expect(await expireNoShows(new Date())).toBe(0);
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
