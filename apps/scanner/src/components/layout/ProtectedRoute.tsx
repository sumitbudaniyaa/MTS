import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { LoadingState } from '@/components/ui/Misc';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  if (status === 'idle' || status === 'authenticating') {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingState label="Loading…" />
      </div>
    );
  }
  if (status !== 'authenticated') return <Navigate to="/login" replace />;
  return <>{children}</>;
}
