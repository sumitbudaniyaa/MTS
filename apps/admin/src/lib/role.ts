import { useAuthStore } from '@/stores/auth.store';

/**
 * Role-based capabilities for the admin app's two tiers.
 *  - SUPER_ADMIN: manages units, personnel and admin accounts; read-only on movies/auditorium.
 *  - ADMIN (operational): manages movies/auditorium/bookings and scanner operators; read-only
 *    on units and USER personnel.
 * These mirror the server-side authorization — the backend is the source of truth; this only
 * hides controls so admins don't hit 403s.
 */
export function useRole() {
  const role = useAuthStore((s) => s.user?.role);
  const isSuperAdmin = role === 'SUPER_ADMIN';
  const isAdmin = role === 'ADMIN';
  return {
    role,
    isSuperAdmin,
    isAdmin,
    /** Create/edit/delete movies & manage the auditorium (operational admin only). */
    canManageMovies: isAdmin,
    /** Create/change/delete units and USER personnel (super admin only). */
    canManagePeople: isSuperAdmin,
    /** Manage admin accounts (super admin only). */
    canManageAdmins: isSuperAdmin,
  };
}

export function roleLabel(role: string | undefined): string {
  if (role === 'SUPER_ADMIN') return 'Super Admin';
  if (role === 'ADMIN') return 'Admin';
  return 'Administrator';
}
