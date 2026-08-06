import type { Request } from 'express';
import { BookingModel, MovieModel } from '../../models/index.js';
import { ApiError } from '../../utils/apiError.js';
import { recordAudit } from '../audit/audit.service.js';
import { AuditAction, TicketStatus } from '../../constants/enums.js';

export interface VerifyResult {
  code: string;
  status: typeof TicketStatus.CHECKED_IN;
  checkedInAt: Date;
  movie: { id: string; title: string; startTime: Date };
  holderMobile: string;
}

/**
 * Verify and check in a ticket by its QR code. The BOOKED -> CHECKED_IN transition is an
 * atomic positional update, so two scanners hitting the same QR concurrently can only
 * succeed once — no double check-in. Non-success states are explained precisely.
 */
export async function verifyTicket(
  code: string,
  scannerId: string,
  req?: Request,
): Promise<VerifyResult> {
  const now = new Date();

  const updated = await BookingModel.findOneAndUpdate(
    { tickets: { $elemMatch: { code, status: TicketStatus.BOOKED } } },
    {
      $set: {
        'tickets.$.status': TicketStatus.CHECKED_IN,
        'tickets.$.checkedIn': true,
        'tickets.$.checkedInAt': now,
        'tickets.$.checkedInBy': scannerId,
      },
    },
    { new: true },
  )
    .populate<{ movie: { _id: string; title: string; startTime: Date } }>('movie', 'title startTime')
    .populate<{ user: { mobile: string } }>('user', 'mobile');

  if (updated) {
    await recordAudit({
      action: AuditAction.TICKET_VERIFY,
      user: scannerId,
      req,
      success: true,
      metadata: { code, bookingId: updated.id, result: 'CHECKED_IN' },
    });
    return {
      code,
      status: TicketStatus.CHECKED_IN,
      checkedInAt: now,
      movie: {
        id: String(updated.movie._id),
        title: updated.movie.title,
        startTime: updated.movie.startTime,
      },
      holderMobile: updated.user.mobile,
    };
  }

  // Not transitioned — figure out exactly why and audit the failed attempt.
  const existing = await BookingModel.findOne({ 'tickets.code': code }, { 'tickets.$': 1 });
  const ticket = existing?.tickets?.[0];
  await recordAudit({
    action: AuditAction.TICKET_VERIFY,
    user: scannerId,
    req,
    success: false,
    metadata: { code, result: ticket?.status ?? 'NOT_FOUND' },
  });

  if (!ticket) throw ApiError.notFound('Ticket not found');
  switch (ticket.status) {
    case TicketStatus.CHECKED_IN:
      throw ApiError.conflict('Ticket already checked in', { checkedInAt: ticket.checkedInAt });
    case TicketStatus.EXPIRED:
      throw ApiError.conflict('Ticket expired — not checked in within the grace period');
    case TicketStatus.RELEASED:
      throw ApiError.conflict('Seat was released — not checked in within the grace period');
    case TicketStatus.CANCELLED:
      throw ApiError.conflict('Ticket was cancelled');
    default:
      throw ApiError.conflict('Ticket cannot be verified');
  }
}

/** Attendance roll-up for a movie: tickets grouped by status. */
export async function attendanceSummary(movieId: string): Promise<{
  movieId: string;
  total: number;
  byStatus: Record<string, number>;
}> {
  const movie = await MovieModel.findById(movieId).select('_id');
  if (!movie) throw ApiError.notFound('Movie not found');

  const rows = await BookingModel.aggregate<{ _id: string; count: number }>([
    { $match: { movie: movie._id } },
    { $unwind: '$tickets' },
    { $group: { _id: '$tickets.status', count: { $sum: 1 } } },
  ]);

  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    byStatus[r._id] = r.count;
    total += r.count;
  }
  return { movieId, total, byStatus };
}
