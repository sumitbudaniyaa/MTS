import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { api, apiErrorMessage } from '@/lib/api';
import type { Booking, BookingMovie, Ticket } from '@/types';
import { LoadingState, EmptyState, ErrorState, Badge } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';

function movieOf(b: Booking): BookingMovie | null {
  return typeof b.movie === 'string' ? null : b.movie;
}
function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const statusTone = {
  BOOKED: 'accent',
  CHECKED_IN: 'success',
  EXPIRED: 'warning',
  CANCELLED: 'danger',
} as const;

export function TicketsPage() {
  const user = useAuthStore((s) => s.user);
  const openLogin = useUiStore((s) => s.openLogin);
  const [active, setActive] = useState<Booking | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['my-bookings'],
    enabled: !!user,
    queryFn: async () => (await api.get<{ items: Booking[] }>('/bookings')).data.items,
  });

  if (!user) {
    return (
      <div className="px-4 pt-5">
        <h1 className="mb-5 text-lg font-semibold tracking-tight">My tickets</h1>
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-muted">Sign in to view your tickets.</p>
          <Button size="sm" onClick={openLogin}>
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-5">
      <h1 className="mb-5 text-lg font-semibold tracking-tight">My tickets</h1>

      {isLoading && <LoadingState />}
      {isError && <ErrorState message={apiErrorMessage(error)} />}
      {data && data.length === 0 && (
        <EmptyState title="No bookings yet" hint="Book a movie to see your tickets here." />
      )}

      <div className="space-y-2.5">
        {data?.map((b) => {
          const movie = movieOf(b);
          const live = b.tickets.filter((t) => t.status === 'BOOKED' || t.status === 'CHECKED_IN');
          return (
            <button
              key={b.id}
              onClick={() => setActive(b)}
              className="card flex w-full items-center justify-between p-3.5 text-left"
            >
              <div>
                <div className="text-sm font-medium">{movie?.title ?? 'Movie'}</div>
                {movie && <div className="mt-0.5 text-xs text-muted">{fmt(movie.startTime)}</div>}
                <div className="mt-1.5 text-xs text-muted">
                  {b.cancelledAt ? 'Cancelled' : `${live.length} active ticket(s)`}
                </div>
              </div>
              <span className="text-muted">›</span>
            </button>
          );
        })}
      </div>

      {active && <TicketDetail booking={active} onClose={() => setActive(null)} />}
    </div>
  );
}

function TicketDetail({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const qc = useQueryClient();
  const movie = movieOf(booking);
  const canCancel = !booking.cancelledAt && booking.tickets.some((t) => t.status === 'BOOKED');

  const cancel = useMutation({
    mutationFn: () => api.post(`/bookings/${booking.id}/cancel`),
    onSuccess: () => {
      toast.success('Booking cancelled');
      qc.invalidateQueries({ queryKey: ['my-bookings'] });
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <Sheet open onClose={onClose} title={movie?.title ?? 'Tickets'}>
      {movie && <p className="mb-4 text-xs text-muted">{fmt(movie.startTime)}</p>}
      <div className="max-h-[55vh] space-y-3 overflow-auto">
        {booking.tickets.map((t: Ticket) => (
          <div key={t.code} className="flex flex-col items-center rounded-lg border border-border p-4">
            <div className="rounded-lg bg-white p-3">
              <QRCodeSVG value={t.code} size={150} level="M" />
            </div>
            {t.seatLabel && <div className="mt-2 text-sm font-semibold">Seat {t.seatLabel}</div>}
            <div className="mt-1 font-mono text-xs">{t.code}</div>
            <div className="mt-1.5">
              <Badge tone={statusTone[t.status]}>{t.status.replace('_', ' ')}</Badge>
            </div>
          </div>
        ))}
      </div>
      {canCancel && (
        <Button variant="danger" className="mt-4 w-full" loading={cancel.isPending} onClick={() => cancel.mutate()}>
          Cancel booking
        </Button>
      )}
    </Sheet>
  );
}
