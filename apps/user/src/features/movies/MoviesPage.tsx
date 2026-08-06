import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, apiErrorMessage } from '@/lib/api';
import type { AvailableMovie } from '@/types';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
function runtimeLabel(minutes: number | undefined): string | null {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m > 0 ? `${m}m` : ''}`.trim() : `${m}m`;
}

/** What the primary action says, and whether it can be pressed. */
function callToAction(m: AvailableMovie): { label: string; disabled: boolean } {
  if (m.soldOut) return { label: 'Sold out', disabled: true };
  if (!m.bookingOpen) {
    return {
      label: `Booking opens ${dateLabel(m.bookingOpensAt)}, ${timeLabel(m.bookingOpensAt)}`,
      disabled: true,
    };
  }
  return { label: 'Book seats', disabled: false };
}

export function MoviesPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const openLogin = useUiStore((s) => s.openLogin);
  const [selected, setSelected] = useState<AvailableMovie | null>(null);

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
        <p className="mt-0.5 text-xs text-muted">Tap a movie for details and seats</p>
      </div>

      {isLoading && <LoadingState />}
      {isError && <ErrorState message={apiErrorMessage(error)} />}
      {data && data.length === 0 && (
        <EmptyState title="No movies available" hint="Check back closer to showtime." />
      )}

      <div className="grid grid-cols-2 gap-3">
        {data?.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setSelected(m)}
            className="overflow-hidden rounded-2xl bg-surface text-left shadow-sm ring-1 ring-border transition active:scale-[0.98]"
          >
            <div className="relative">
              {m.poster ? (
                <img src={m.poster} alt="" className="aspect-[2/3] w-full object-cover" />
              ) : (
                <div className="flex aspect-[2/3] w-full items-center justify-center bg-surface-2 p-2 text-center text-sm font-semibold text-muted">
                  {m.title}
                </div>
              )}
              <span
                className={
                  'absolute right-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium backdrop-blur ' +
                  (m.soldOut ? 'bg-black/60 text-white' : 'bg-white/85 text-fg')
                }
              >
                {m.soldOut ? 'Sold out' : `${m.availableSeats} left`}
              </span>
            </div>
            <div className="p-2.5">
              <h2 className="truncate text-sm font-semibold text-fg">{m.title}</h2>
              <p className="mt-0.5 text-[11px] text-muted">
                {dateLabel(m.startTime)} · {timeLabel(m.startTime)}
              </p>
            </div>
          </button>
        ))}
      </div>

      <MovieDetailsSheet
        movie={selected}
        onClose={() => setSelected(null)}
        onBook={(m) => {
          setSelected(null);
          handleBook(m);
        }}
      />
    </div>
  );
}

function MovieDetailsSheet({
  movie,
  onClose,
  onBook,
}: {
  movie: AvailableMovie | null;
  onClose: () => void;
  onBook: (m: AvailableMovie) => void;
}) {
  // Stays mounted across close so the panel can animate back down; the Sheet keeps rendering
  // the last children it was given, so the content doesn't blank out mid-animation.
  const cta = movie ? callToAction(movie) : null;
  const runtime = movie ? runtimeLabel(movie.durationMinutes) : null;
  if (!movie) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;

  return (
    <Sheet open onClose={onClose}>
      <div className="flex gap-3.5">
        {movie.poster ? (
          <img
            src={movie.poster}
            alt=""
            className="h-32 w-[5.5rem] shrink-0 rounded-xl object-cover ring-1 ring-border"
          />
        ) : (
          <div className="flex h-32 w-[5.5rem] shrink-0 items-center justify-center rounded-xl bg-surface-2 text-xs text-muted">
            No poster
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-fg">{movie.title}</h2>
          <p className="mt-1 text-xs text-muted">
            {dateLabel(movie.startTime)} · {timeLabel(movie.startTime)}
          </p>
          {runtime && <p className="mt-0.5 text-xs text-muted">Runtime {runtime}</p>}
          <p className="mt-1.5 text-xs font-medium text-fg">
            {movie.soldOut ? 'Sold out' : `${movie.availableSeats} seats left`}
          </p>
        </div>
      </div>

      {movie.description && (
        <p className="mt-4 text-sm leading-relaxed text-muted">{movie.description}</p>
      )}

      <Button className="mt-5 w-full" disabled={cta!.disabled} onClick={() => onBook(movie)}>
        {cta!.label}
      </Button>
    </Sheet>
  );
}
