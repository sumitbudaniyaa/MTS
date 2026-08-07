import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuthBootstrap } from '@/features/auth/useAuth';
import { useAuthStore } from '@/stores/auth.store';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { AppLayout } from '@/components/layout/AppLayout';
import { OpsLayout } from '@/components/layout/OpsLayout';
import { LoginPage } from '@/features/auth/LoginPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { UnitsPage } from '@/features/units/UnitsPage';
import { ScannersPage } from '@/features/scanners/ScannersPage';
import { UnitDetailsPage } from '@/features/units/UnitDetailsPage';
import { MoviesPage } from '@/features/movies/MoviesPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { AuditPage } from '@/features/audit/AuditPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { AuditoriumPage } from '@/features/auditorium/AuditoriumPage';
import { ScanPage } from '@/features/scan/ScanPage';

function LoginRoute() {
  const status = useAuthStore((s) => s.status);
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <LoginPage />;
}

/**
 * The two tiers get genuinely different apps, not one app with things hidden.
 *
 * - **ADMIN** (operational) runs shows, typically from a phone at the venue: schedule movies,
 *   manage door staff, scan tickets. Three tabs, nothing else.
 * - **SUPER_ADMIN** owns the desk work — units, personnel, admin accounts, the auditorium
 *   layout, timings, reports and audit — in the full sidebar console.
 *
 * Routes are declared per tier rather than filtered, so an ADMIN typing `/audit` lands back on
 * their own home instead of hitting a page that would 403 anyway.
 */
function OpsRoutes() {
  return (
    <Routes>
      <Route
        element={
          <ProtectedRoute>
            <OpsLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/movies" element={<MoviesPage />} />
        <Route path="/scanners" element={<ScannersPage />} />
        <Route path="/scan" element={<ScanPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/movies" replace />} />
    </Routes>
  );
}

function ConsoleRoutes() {
  return (
    <Routes>
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/units" element={<UnitsPage />} />
        <Route path="/units/:id" element={<UnitDetailsPage />} />
        <Route path="/scanners" element={<ScannersPage />} />
        <Route path="/movies" element={<MoviesPage />} />
        <Route path="/auditorium" element={<AuditoriumPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function RoleRoutes() {
  const role = useAuthStore((s) => s.user?.role);
  const status = useAuthStore((s) => s.status);
  // Until the silent re-auth resolves we don't know the tier. Rendering either shell now would
  // flash the wrong one and, worse, redirect: ConsoleRoutes' catch-all would bounce an ADMIN
  // off /scan before their role arrived.
  if (status === 'idle' || status === 'authenticating') {
    return (
      <Routes>
        <Route path="*" element={<ProtectedRoute>{null}</ProtectedRoute>} />
      </Routes>
    );
  }
  return role === 'ADMIN' ? <OpsRoutes /> : <ConsoleRoutes />;
}

export function App() {
  useAuthBootstrap();
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route path="*" element={<RoleRoutes />} />
      </Routes>
    </BrowserRouter>
  );
}
