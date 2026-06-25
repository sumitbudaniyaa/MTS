import { useQuery } from '@tanstack/react-query';
import { api, apiErrorMessage } from '@/lib/api';
import type { Movie, MovieStatus, Paginated } from '@/types';
import { Badge, LoadingState, EmptyState, ErrorState } from '@/components/ui/Misc';
import { cn } from '@/lib/cn';

const statusTone: Record<MovieStatus, 'neutral' | 'accent' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'neutral',
  SCHEDULED: 'accent',
  OPEN: 'success',
  POOL_RELEASED: 'warning',
  CLOSED: 'neutral',
  CANCELLED: 'danger',
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Grid of selectable movie cards (replaces a plain dropdown). */
export function MoviePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['movies', 'all'],
    queryFn: async () => (await api.get<Paginated<Movie>>('/movies', { params: { limit: 100 } })).data,
  });

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState message={apiErrorMessage(error)} />;
  if (!data || data.items.length === 0) return <EmptyState title="No movies yet" />;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {data.items.map((m) => {
        const selected = m.id === value;
        return (
          <button
            key={m.id}
            onClick={() => onChange(m.id)}
            className={cn(
              'rounded-lg border p-3 text-left transition-colors',
              selected
                ? 'border-accent bg-accent/5 ring-1 ring-accent'
                : 'border-border bg-surface hover:bg-surface-2',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="line-clamp-1 text-sm font-medium">{m.title}</span>
              <Badge tone={statusTone[m.status]}>{m.status}</Badge>
            </div>
            <div className="mt-1.5 text-xs text-muted">{fmt(m.startTime)}</div>
            <div className="mt-1 text-xs text-muted">
              {m.seatsBooked}/{m.totalSeats} seats
            </div>
          </button>
        );
      })}
    </div>
  );
}
