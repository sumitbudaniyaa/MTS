import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuthBootstrap } from '@/features/auth/useAuth';
import { AppLayout } from '@/components/layout/AppLayout';
import { MoviesPage } from '@/features/movies/MoviesPage';
import { TicketsPage } from '@/features/bookings/TicketsPage';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { SeatPickerPage } from '@/features/booking/SeatPickerPage';

export function App() {
  // Silent re-auth on load; the app is browsable without logging in.
  useAuthBootstrap();
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<MoviesPage />} />
          <Route path="/tickets" element={<TicketsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/book/:movieId" element={<SeatPickerPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
