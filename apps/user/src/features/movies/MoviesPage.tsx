import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, apiErrorMessage } from '@/lib/api';
import type { AvailableMovie } from '@/types';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function MoviesPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const openLogin = useUiStore((s) => s.openLogin);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['available-movies'],
    queryFn: async () =>
      (await api.get<{ items: AvailableMovie[] }>('/movies/available')).data.items,
  });

  const handleBook = (m: AvailableMovie) => {
    if (!user) {
      openLogin(); // bottom-drawer login; no redirect
      return;
    }
    navigate(`/book/${m.id}`); // choose seats on the live seat map
  };

  return (
    <div className="px-4 pt-5">
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Now Showing</h1>
        <p className="mt-0.5 text-xs text-muted">Pick a movie and choose your seats</p>
      </div>

      {isLoading && <LoadingState />}
      {isError && <ErrorState message={apiErrorMessage(error)} />}
      {data && data.length === 0 && (
        <EmptyState title="No movies available" hint="Check back closer to showtime." />
      )}

      <div className="grid grid-cols-1 gap-4">
        {data?.map((m) => {
          const opensAt = new Date(new Date(m.startTime).getTime() - 60 * 60_000);
          const cta = m.soldOut
            ? 'Sold out'
            : !m.bookingOpen
              ? `Booking opens ${dateLabel(opensAt.toISOString())}, ${timeLabel(opensAt.toISOString())}`
              : 'Book seats';
          return (
            <div key={m.id} className="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-border">
              <div className="relative">
                {m.poster ? (
                  <img src={m.poster} alt={m.title} className="h-52 w-full object-cover" />
                ) : (
                  <div className="flex h-40 w-full items-center justify-center bg-surface-2 text-base font-semibold text-muted">
                    {m.title}
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-3 pt-10">
                  <h2 className="text-base font-semibold text-white drop-shadow">{m.title}</h2>
                  <p className="text-[11px] text-white/80">
                    {dateLabel(m.startTime)} · {timeLabel(m.startTime)}
                  </p>
                </div>
                <span
                  className={
                    'absolute right-2.5 top-2.5 rounded-full px-2 py-0.5 text-[11px] font-medium backdrop-blur ' +
                    (m.soldOut ? 'bg-black/60 text-white' : 'bg-white/85 text-fg')
                  }
                >
                  {m.soldOut ? 'Sold out' : `${m.availableSeats} left`}
                </span>
              </div>
              {m.description && (
                <p className="line-clamp-2 px-3.5 pt-3 text-xs text-muted">{m.description}</p>
              )}
              <div className="p-3.5">
                <Button
                  className="w-full"
                  disabled={m.soldOut || !m.bookingOpen}
                  onClick={() => handleBook(m)}
                >
                  {cta}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
