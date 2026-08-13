import {
  AdminModel,
  BookingModel,
  MovieModel,
  ScannerModel,
  SeatAllocationModel,
  movieEndTime,
  UnitModel,
  UserModel,
} from '../../models/index.js';
import { ApiError } from '../../utils/apiError.js';
import { MovieStatus, TicketStatus } from '../../constants/enums.js';

/** High-level dashboard counters. */
export async function overview() {
  const [units, personnel, scanners, movies, upcoming, ticketsAgg] = await Promise.all([
    UnitModel.countDocuments({}),
    UserModel.countDocuments({}),
    ScannerModel.countDocuments({}),
    MovieModel.countDocuments({}),
    MovieModel.countDocuments({
      status: { $in: [MovieStatus.SCHEDULED, MovieStatus.OPEN] },
      startTime: { $gte: new Date() },
    }),
    BookingModel.aggregate<{ _id: string; count: number }>([
      { $unwind: '$tickets' },
      { $group: { _id: '$tickets.status', count: { $sum: 1 } } },
    ]),
  ]);

  const tickets: Record<string, number> = {};
  for (const r of ticketsAgg) tickets[r._id] = r.count;

  // Upcoming/ongoing movies with live booking counts (next 8 by showtime).
  const upcomingList = await MovieModel.find({
    status: { $in: [MovieStatus.SCHEDULED, MovieStatus.OPEN] },
    startTime: { $gte: new Date(Date.now() - 6 * 60 * 60_000) },
  })
    .sort('startTime')
    .limit(8)
    .select('title poster startTime status seatsBooked totalSeats poolSeats');

  // Latest bookings across all personnel.
  const recent = await BookingModel.find({})
    .populate<{ user: { mobile: string; name: string } | null }>('user', 'mobile name')
    .populate<{ movie: { title: string; startTime: Date } | null }>('movie', 'title startTime')
    .sort('-createdAt')
    .limit(8);

  return {
    units,
    personnel,
    scanners,
    movies,
    upcomingMovies: upcoming,
    tickets: {
      booked: tickets[TicketStatus.BOOKED] ?? 0,
      checkedIn: tickets[TicketStatus.CHECKED_IN] ?? 0,
      expired: tickets[TicketStatus.EXPIRED] ?? 0,
      released: tickets[TicketStatus.RELEASED] ?? 0,
      cancelled: tickets[TicketStatus.CANCELLED] ?? 0,
    },
    upcoming: upcomingList.map((m) => ({
      id: m.id,
      title: m.title,
      poster: m.poster,
      startTime: m.startTime,
      status: m.status,
      seatsBooked: m.seatsBooked,
      totalSeats: m.totalSeats,
      poolSeats: m.poolSeats,
    })),
    recentBookings: recent.map((b) => ({
      id: b.id,
      mobile: b.user?.mobile ?? '—',
      name: b.user?.name ?? '',
      movieTitle: b.movie?.title ?? 'Movie',
      quantity: b.quantity,
      status: b.cancelledAt ? 'CANCELLED' : 'ACTIVE',
      createdAt: (b as unknown as { createdAt: Date }).createdAt,
    })),
  };
}

/**
 * Per-movie report: capacity, seat economy, per-unit allocation usage, attendance.
 *
 * Only available once the show has ended. Mid-screening the attendance figures are
 * meaningless — an un-scanned ticket is indistinguishable from someone who simply hasn't
 * reached the door yet — and the reclaim job has not finished resolving every ticket.
 */
export async function movieReport(movieId: string, now: Date = new Date()) {
  const movie = await MovieModel.findById(movieId);
  if (!movie) throw ApiError.notFound('Movie not found');

  const endsAt = movieEndTime(movie);
  if (now.getTime() < endsAt.getTime()) {
    throw ApiError.conflict('Report is available once the show has ended', {
      availableAt: endsAt,
    });
  }

  const [ticketsAgg, unitAgg, allocDocs, scannerAgg] = await Promise.all([
    BookingModel.aggregate<{ _id: string; count: number }>([
      { $match: { movie: movie._id } },
      { $unwind: '$tickets' },
      { $group: { _id: '$tickets.status', count: { $sum: 1 } } },
    ]),
    // Actual bookings grouped by the booker's unit (seat-based system; quota tables unused).
    BookingModel.aggregate<{ _id: unknown; booked: number; checkedIn: number }>([
      { $match: { movie: movie._id } },
      { $unwind: '$tickets' },
      {
        $group: {
          _id: '$unit',
          booked: {
            $sum: {
              $cond: [{ $in: ['$tickets.status', [TicketStatus.BOOKED, TicketStatus.CHECKED_IN]] }, 1, 0],
            },
          },
          checkedIn: {
            $sum: { $cond: [{ $eq: ['$tickets.status', TicketStatus.CHECKED_IN] }, 1, 0] },
          },
        },
      },
    ]),
    // Per-unit quota (allocated / released) set by admin before the show.
    SeatAllocationModel.find({ movie: movie._id }).select('unit allocated released'),
    // Scanner / Door staff check-in activity breakdown.
    BookingModel.aggregate<{
      _id: { by: unknown; model: string };
      count: number;
    }>([
      { $match: { movie: movie._id } },
      { $unwind: '$tickets' },
      {
        $match: {
          'tickets.status': TicketStatus.CHECKED_IN,
          'tickets.checkedInBy': { $ne: null },
        },
      },
      {
        $group: {
          _id: { by: '$tickets.checkedInBy', model: '$tickets.checkedInByModel' },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const byStatus: Record<string, number> = {};
  for (const r of ticketsAgg) byStatus[r._id] = r.count;

  // Resolve unit names for the per-unit breakdown.
  const unitIds = unitAgg.map((u) => u._id).filter(Boolean);
  const units = await UnitModel.find({ _id: { $in: unitIds } }).select('name');
  const nameById = new Map(units.map((u) => [String(u._id), u.name]));

  // Map unitId -> total allocated quota across all rank rows for that unit.
  const allocById = new Map<string, number>();
  for (const a of allocDocs) {
    const key = String(a.unit);
    allocById.set(key, (allocById.get(key) ?? 0) + a.allocated);
  }

  // Resolve scanner and admin staff names for door activity.
  const scannerIds = scannerAgg.filter((s) => s._id.model === 'Scanner').map((s) => s._id.by);
  const adminIds = scannerAgg.filter((s) => s._id.model === 'Admin').map((s) => s._id.by);

  const [scannerDocs, adminDocs] = await Promise.all([
    scannerIds.length > 0 ? ScannerModel.find({ _id: { $in: scannerIds } }) : [],
    adminIds.length > 0 ? AdminModel.find({ _id: { $in: adminIds } }) : [],
  ]);

  const scannerMap = new Map((scannerDocs as Array<{ _id: unknown; mobile?: string }>).map((s) => [String(s._id), s.mobile || 'Scanner']));
  const adminMap = new Map((adminDocs as Array<{ _id: unknown; name?: string; mobile?: string }>).map((a) => [String(a._id), a.name || a.mobile || 'Admin']));

  const scannerActivity = scannerAgg
    .map((s) => {
      const idStr = String(s._id.by);
      const isScanner = s._id.model === 'Scanner';
      const name = isScanner ? (scannerMap.get(idStr) ?? 'Scanner') : (adminMap.get(idStr) ?? 'Admin');
      return {
        name,
        type: isScanner ? ('Scanner' as const) : ('Admin' as const),
        count: s.count,
      };
    })
    .sort((a, b) => b.count - a.count);

  const checkedIn = byStatus[TicketStatus.CHECKED_IN] ?? 0;
  const expired = byStatus[TicketStatus.EXPIRED] ?? 0;
  const released = byStatus[TicketStatus.RELEASED] ?? 0;
  const cancelled = byStatus[TicketStatus.CANCELLED] ?? 0;

  const totalBooked = checkedIn + expired + released;
  const turnoutRate = totalBooked > 0 ? Math.round((checkedIn / totalBooked) * 100) : 0;
  const occupancyRate = movie.totalSeats > 0 ? Math.round((movie.seatsBooked / movie.totalSeats) * 100) : 0;
  const unsoldSeats = Math.max(0, movie.totalSeats - movie.seatsBooked);

  return {
    movie: {
      id: movie.id,
      title: movie.title,
      startTime: movie.startTime,
      status: movie.status,
      totalSeats: movie.totalSeats,
      seatsBooked: movie.seatsBooked,
      poolSeats: movie.poolSeats,
      unsoldSeats,
      availableSeats: unsoldSeats,
    },
    rates: {
      turnoutRate,
      occupancyRate,
    },
    unitBookings: unitAgg
      .map((u) => {
        const booked = Math.max(0, u.booked);
        return {
          unit: u._id ? (nameById.get(String(u._id)) ?? 'Unknown') : 'Open pool',
          allocated: u._id ? (allocById.get(String(u._id)) ?? null) : null,
          booked,
          checkedIn: u.checkedIn,
        };
      })
      .filter((u) => u.booked > 0)
      .sort((a, b) => b.booked - a.booked),
    endTime: endsAt,
    attendance: {
      checkedIn,
      expired,
      released,
      cancelled,
    },
    scannerActivity,
  };
}
