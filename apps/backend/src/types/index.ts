export const Roles = {
  // Top account: manages units, personnel and admin accounts; read-only on movies/auditorium.
  SUPER_ADMIN: 'SUPER_ADMIN',
  // Operational admin (created by a super admin): manages movies/auditorium/bookings and can
  // manage scanner operators, but is read-only on units and USER personnel.
  ADMIN: 'ADMIN',
  USER: 'USER',
  SCANNER: 'SCANNER',
} as const;

export type Role = (typeof Roles)[keyof typeof Roles];

/** Decoded access-token claims attached to authenticated requests. */
export interface AuthPrincipal {
  sub: string; // user id
  role: Role;
  unit?: string; // unit id (USER only)
  /**
   * The account still holds a password someone else set. Carried in the access token so the
   * gate is a token read rather than a database hit on every request; the token is short-lived,
   * and changing the password mints a fresh one immediately so the gate lifts at once.
   */
  mustChangePassword?: boolean;
  /** Epoch ms when a borrowed password stops being accepted. */
  passwordExpiresAt?: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: AuthPrincipal;
    }
  }
}

export {};
