import {
  BookingModel,
  MovieModel,
  ScannerModel,
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
      status: { $in: [MovieStatus.SCHEDULED, MovieStatus.OPEN, MovieStatus.POOL_RELEASED] },
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
    status: { $in: [MovieStatus.SCHEDULED, MovieStatus.OPEN, MovieStatus.POOL_RELEASED] },
    startTime: { $gte: new Date(Date.now() - 6 * 60 * 60_000) },
  })
    .sort('startTime')
    .limit(8)
    .select('title startTime status seatsBooked totalSeats poolSeats');

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
      cancelled: tickets[TicketStatus.CANCELLED] ?? 0,
    },
    upcoming: upcomingList.map((m) => ({
      id: m.id,
      title: m.title,
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

/** Per-movie report: capacity, seat economy, per-unit allocation usage, attendance. */
export async function movieReport(movieId: string) {
  const movie = await MovieModel.findById(movieId);
  if (!movie) throw ApiError.notFound('Movie not found');

  const [ticketsAgg, unitAgg] = await Promise.all([
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
  ]);

  const byStatus: Record<string, number> = {};
  for (const r of ticketsAgg) byStatus[r._id] = r.count;

  // Resolve unit names for the per-unit breakdown.
  const unitIds = unitAgg.map((u) => u._id).filter(Boolean);
  const units = await UnitModel.find({ _id: { $in: unitIds } }).select('name');
  const nameById = new Map(units.map((u) => [String(u._id), u.name]));

  return {
    movie: {
      id: movie.id,
      title: movie.title,
      startTime: movie.startTime,
      status: movie.status,
      totalSeats: movie.totalSeats,
      seatsBooked: movie.seatsBooked,
      poolSeats: movie.poolSeats,
      availableSeats: Math.max(0, movie.totalSeats - movie.seatsBooked),
    },
    unitBookings: unitAgg
      .map((u) => ({
        unit: u._id ? (nameById.get(String(u._id)) ?? 'Unknown') : 'Open pool',
        booked: u.booked,
        checkedIn: u.checkedIn,
      }))
      .filter((u) => u.booked > 0)
      .sort((a, b) => b.booked - a.booked),
    attendance: {
      booked: byStatus[TicketStatus.BOOKED] ?? 0,
      checkedIn: byStatus[TicketStatus.CHECKED_IN] ?? 0,
      expired: byStatus[TicketStatus.EXPIRED] ?? 0,
      cancelled: byStatus[TicketStatus.CANCELLED] ?? 0,
    },
  };
}
