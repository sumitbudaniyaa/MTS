export type Role = 'ADMIN' | 'USER' | 'SCANNER';

export interface AuthUser {
  id: string;
  mobile: string;
  name: string;
  role: Role;
  unit: string | null;
}

export interface VerifyResult {
  code: string;
  status: 'CHECKED_IN';
  checkedInAt: string;
  movie: { id: string; title: string; startTime: string };
  holderMobile: string;
}

export interface ScannerMovie {
  id: string;
  title: string;
  poster: string;
  startTime: string;
  status: string;
  seatsBooked: number;
  totalSeats: number;
}
