export type Role = 'ADMIN' | 'USER' | 'SCANNER';

export interface AuthUser {
  id: string;
  mobile: string;
  name: string;
  role: Role;
  unit: string | null;
  /** Still holding a password an admin set; prompt for a new one. */
  mustChangePassword?: boolean;
  /** When the borrowed password stops working — used to count down the nudge. */
  passwordExpiresAt?: string | null;
}

/** USER-facing movie projection — no unit/allocation/internal fields. */
export interface AvailableMovie {
  id: string;
  title: string;
  description: string;
  poster: string;
  showDate: string;
  startTime: string;
  endTime: string;
  durationMinutes?: number;
  availableSeats: number;
  soldOut: boolean;
  /** When seats become bookable — sent by the API because the lead time is configurable. */
  bookingOpensAt: string;
  bookingOpen: boolean;
}

export type TicketStatus = 'BOOKED' | 'CHECKED_IN' | 'EXPIRED' | 'RELEASED' | 'CANCELLED';

export interface Ticket {
  code: string;
  seatLabel?: string | null;
  status: TicketStatus;
  checkedIn: boolean;
  checkedInAt: string | null;
}

export interface BookingMovie {
  id: string;
  title: string;
  poster: string;
  showDate: string;
  startTime: string;
  status: string;
}

export interface Booking {
  id: string;
  movie: BookingMovie | string;
  quantity: number;
  cancelledAt: string | null;
  createdAt: string;
  tickets: Ticket[];
}
