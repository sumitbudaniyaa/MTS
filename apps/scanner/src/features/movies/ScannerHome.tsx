import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, apiErrorMessage } from '@/lib/api';
import type { ScannerMovie } from '@/types';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/Misc';
import { logout } from '@/features/auth/useAuth';

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function ScannerHome() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['scanner-movies'],
    queryFn: async () => (await api.get<{ items: ScannerMovie[] }>('/movies/scanner')).data.items,
    refetchInterval: 30_000,
  });

  return (
    <div className="mx-auto flex h-full max-w-md flex-col px-4 py-5">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Tickets</h1>
          <p className="text-xs text-muted">Pick a movie to start scanning</p>
        </div>
        <button
          onClick={async () => {
            await logout();
            navigate('/login');
          }}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-2"
        >
          Sign out
        </button>
      </header>

      {isLoading && <LoadingState />}
      {isError && <ErrorState message={apiErrorMessage(error)} />}
      {data && data.length === 0 && (
        <EmptyState title="No active movies" hint="Movies appear here around showtime." />
      )}

      <div className="space-y-2.5">
        {data?.map((m) => (
          <button
            key={m.id}
            onClick={() => navigate(`/scan/${m.id}`)}
            className="card flex w-full items-center justify-between p-3.5 text-left active:bg-surface-2"
          >
            <div>
              <div className="text-sm font-medium">{m.title}</div>
              <div className="mt-0.5 text-xs text-muted">{fmt(m.startTime)}</div>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold">
                {m.seatsBooked}/{m.totalSeats}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-muted">booked</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
