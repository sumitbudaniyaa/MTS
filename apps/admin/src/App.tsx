import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuthBootstrap } from '@/features/auth/useAuth';
import { useAuthStore } from '@/stores/auth.store';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoginPage } from '@/features/auth/LoginPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { UnitsPage } from '@/features/units/UnitsPage';
import { ScannersPage } from '@/features/scanners/ScannersPage';
import { UnitDetailsPage } from '@/features/units/UnitDetailsPage';
import { MoviesPage } from '@/features/movies/MoviesPage';
import { AllocationsPage } from '@/features/seats/AllocationsPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { AuditPage } from '@/features/audit/AuditPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { AuditoriumPage } from '@/features/auditorium/AuditoriumPage';

function LoginRoute() {
  const status = useAuthStore((s) => s.status);
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <LoginPage />;
}

export function App() {
  useAuthBootstrap();
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
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
          <Route path="/allocations" element={<AllocationsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
