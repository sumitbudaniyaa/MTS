import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuthBootstrap } from '@/features/auth/useAuth';
import { useAuthStore } from '@/stores/auth.store';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { LoginPage } from '@/features/auth/LoginPage';
import { ScannerHome } from '@/features/movies/ScannerHome';
import { ScanPage } from '@/features/scan/ScanPage';

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
          path="/"
          element={
            <ProtectedRoute>
              <ScannerHome />
            </ProtectedRoute>
          }
        />
        <Route
          path="/scan/:movieId"
          element={
            <ProtectedRoute>
              <ScanPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
