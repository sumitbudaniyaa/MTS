export const Roles = {
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
