export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER' | 'SCANNER';

export interface AuthUser {
  id: string;
  mobile: string;
  name: string;
  role: Role;
  unit: string | null;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Unit {
  id: string;
  name: string;
  loginMode?: 'MOBILE' | 'USERNAME';
  active: boolean;
  createdAt: string;
}

export type MaritalStatus = 'SINGLE' | 'MARRIED';
export type Rank = 'OFFICER' | 'JCO' | 'JAWAN';

export interface Personnel {
  id: string;
  mobile: string;
  username?: string | null;
  name: string;
  role: Role;
  rank?: Rank | null;
  unit: { id: string; name: string } | string | null;
  active: boolean;
  maritalStatus?: MaritalStatus;
  spouseMobile?: string | null;
  spouseUsername?: string | null;
  numberOfKids?: number;
  familySize?: number;
  lastLoginAt?: string | null;
  failedLoginCount?: number;
  lockedUntil?: string | null;
}

export type MovieStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'OPEN'
  | 'COMPLETED'
  | 'CLOSED'
  | 'CANCELLED';

export interface Movie {
  id: string;
  title: string;
  description: string;
  poster: string;
  showDate: string;
  startTime: string;
  durationMinutes?: number;
  totalSeats: number;
  seatsBooked: number;
  poolSeats: number;
  status: MovieStatus;
  openToAll?: boolean;
}

export interface SeatAllocation {
  id: string;
  unit: { id: string; name: string } | string;
  rank?: Rank;
  allocated: number;
  booked: number;
  released: number;
}

export interface AuditLog {
  id: string;
  action: string;
  user: { id: string; mobile: string; name: string; role: Role } | null;
  ip: string | null;
  metadata: Record<string, unknown>;
  success: boolean;
  createdAt: string;
}

export interface UpcomingMovie {
  id: string;
  title: string;
  poster: string;
  startTime: string;
  status: MovieStatus;
  seatsBooked: number;
  totalSeats: number;
  poolSeats: number;
}

export interface RecentBooking {
  id: string;
  mobile: string;
  name: string;
  movieTitle: string;
  quantity: number;
  status: 'ACTIVE' | 'CANCELLED';
  createdAt: string;
}

export interface Overview {
  units: number;
  personnel: number;
  scanners: number;
  movies: number;
  upcomingMovies: number;
  tickets: { booked: number; checkedIn: number; expired: number; released: number; cancelled: number };
  upcoming: UpcomingMovie[];
  recentBookings: RecentBooking[];
}
