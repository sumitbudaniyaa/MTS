/** Domain enumerations shared across models, services and validation schemas. */

export const MovieStatus = {
  DRAFT: 'DRAFT',
  SCHEDULED: 'SCHEDULED',
  OPEN: 'OPEN', // visibility window started; bookable
  POOL_RELEASED: 'POOL_RELEASED', // unused quota moved to common pool (at startTime)
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
} as const;
export type MovieStatusType = (typeof MovieStatus)[keyof typeof MovieStatus];

export const TicketStatus = {
  BOOKED: 'BOOKED',
  CHECKED_IN: 'CHECKED_IN',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type TicketStatusType = (typeof TicketStatus)[keyof typeof TicketStatus];

export const BookingSource = {
  UNIT_QUOTA: 'UNIT_QUOTA',
  OPEN_POOL: 'OPEN_POOL',
} as const;
export type BookingSourceType = (typeof BookingSource)[keyof typeof BookingSource];

export const MaritalStatus = {
  SINGLE: 'SINGLE',
  MARRIED: 'MARRIED',
} as const;
export type MaritalStatusType = (typeof MaritalStatus)[keyof typeof MaritalStatus];

export const Rank = {
  OFFICER: 'OFFICER',
  JCO: 'JCO',
  JAWAN: 'JAWAN',
} as const;
export type RankType = (typeof Rank)[keyof typeof Rank];

export const SeatStatus = {
  FREE: 'FREE', // available
  HELD: 'HELD', // temporarily reserved while someone books (2-min hold)
  BOOKED: 'BOOKED', // confirmed
} as const;
export type SeatStatusType = (typeof SeatStatus)[keyof typeof SeatStatus];

export const AuditAction = {
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  MOVIE_CREATE: 'MOVIE_CREATE',
  UNIT_CREATE: 'UNIT_CREATE',
  PERSONNEL_CREATE: 'PERSONNEL_CREATE',
  BOOKING_CREATE: 'BOOKING_CREATE',
  BOOKING_CANCEL: 'BOOKING_CANCEL',
  TICKET_VERIFY: 'TICKET_VERIFY',
} as const;
export type AuditActionType = (typeof AuditAction)[keyof typeof AuditAction];
