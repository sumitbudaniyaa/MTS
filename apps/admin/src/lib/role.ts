import { useAuthStore } from '@/stores/auth.store';

/**
 * Role-based capabilities for the admin app's two tiers.
 *  - ADMIN (operational): runs shows from a phone — movies, scanner operators, door check-in.
 *  - SUPER_ADMIN: the desk work — units, personnel, admin accounts, the auditorium layout and
 *    the operational timings, plus reports and audit.
 *
 * The venue-shape settings (auditorium, timings) sit with SUPER_ADMIN rather than the
 * operational admin: they are set-once policy, and the operational console is a handset.
 *
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
    /** Create/edit/delete movies and manage scanner operators (operational admin only). */
    canManageMovies: isAdmin,
    /** Design the auditorium layout (super admin only). */
    canManageAuditorium: isSuperAdmin,
    /** Change the operational timings (super admin only). */
    canManageTimings: isSuperAdmin,
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
