import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/apiError.js';
import * as svc from './booking.service.js';
import type { CreateBookingInput } from './booking.schema.js';
import type { BookingDoc } from '../../models/index.js';

/** Public booking projection — exposes tickets + QR codes, hides internal source/unit. */
function toBookingView(b: BookingDoc) {
  return {
    id: b.id,
    movie: b.movie,
    quantity: b.quantity,
    cancelledAt: b.cancelledAt,
    createdAt: (b as unknown as { createdAt: Date }).createdAt,
    tickets: b.tickets.map((t) => ({
      code: t.code,
      seatLabel: t.seatLabel,
      status: t.status,
      checkedIn: t.checkedIn,
      checkedInAt: t.checkedInAt,
    })),
  };
}

export const createBooking = asyncHandler(async (req: Request, res: Response) => {
  if (!req.principal) throw ApiError.unauthorized();
  const body = req.body as CreateBookingInput;
  const booking = await svc.createBooking({
    userId: req.principal.sub,
    unitId: req.principal.unit ?? null,
    movieId: body.movieId,
    quantity: body.quantity,
    idempotencyKey: body.idempotencyKey,
    req,
  });
  res.status(201).json({ booking: toBookingView(booking) });
});

export const listMyBookings = asyncHandler(async (req: Request, res: Response) => {
  if (!req.principal) throw ApiError.unauthorized();
  const bookings = await svc.listMyBookings(req.principal.sub);
  res.json({ items: bookings.map(toBookingView) });
});

export const getMyBooking = asyncHandler(async (req: Request, res: Response) => {
  if (!req.principal) throw ApiError.unauthorized();
  const booking = await svc.getMyBooking(req.params.id as string, req.principal.sub);
  res.json({ booking: toBookingView(booking) });
});

export const cancelBooking = asyncHandler(async (req: Request, res: Response) => {
  if (!req.principal) throw ApiError.unauthorized();
  const booking = await svc.cancelBooking(req.params.id as string, req.principal.sub, req);
  res.json({ booking: toBookingView(booking) });
});

export const getAllowance = asyncHandler(async (req: Request, res: Response) => {
  if (!req.principal) throw ApiError.unauthorized();
  res.json(await svc.getAllowance(req.principal.sub, req.params.movieId as string));
});
