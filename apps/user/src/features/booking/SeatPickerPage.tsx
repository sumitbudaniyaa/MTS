import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, apiErrorMessage } from '@/lib/api';
import { createSocket } from '@/lib/socket';
import { Button } from '@/components/ui/Button';
import { LoadingState, ErrorState } from '@/components/ui/Misc';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { cn } from '@/lib/cn';

type Status = 'FREE' | 'HELD' | 'BOOKED';
interface SeatView {
  label: string;
  row: string;
  number: number;
  status: Status;
  allowedRanks: string[];
  bookable: boolean;
  mine: boolean;
}
interface SeatMap {
  rows: string[];
  seats: SeatView[];
}

const HOLD_SECONDS = 120;

export function SeatPickerPage() {
  const { movieId } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const openLogin = useUiStore((s) => s.openLogin);

  const [selected, setSelected] = useState<string[]>([]);
  const [live, setLive] = useState<Record<string, Status>>({});
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [booking, setBooking] = useState(false);
  const idemRef = useRef<string>(crypto.randomUUID());

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['seatmap', movieId],
    enabled: !!movieId && !!user,
    queryFn: async () => (await api.get<SeatMap>(`/seating/movies/${movieId}/seats`)).data,
  });

  // ---- live updates ----
  useEffect(() => {
    if (!movieId || !user) return;
    const socket = createSocket();
    socket.emit('movie:join', movieId);
    socket.on('seats:update', (p: { movieId: string; seats: { label: string; status: Status }[] }) => {
      if (p.movieId !== movieId) return;
      setLive((prev) => {
        const next = { ...prev };
        for (const s of p.seats) next[s.label] = s.status;
        return next;
      });
      // Drop any of my selected seats that got reclaimed (no longer HELD).
      setSelected((sel) => sel.filter((l) => !p.seats.some((s) => s.label === l && s.status !== 'HELD')));
    });
    return () => {
      socket.emit('movie:leave', movieId);
      socket.disconnect();
    };
  }, [movieId, user]);

  // ---- hold countdown ----
  useEffect(() => {
    if (selected.length === 0) {
      setSecondsLeft(0);
      return;
    }
    const t = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(t);
          setSelected([]);
          toast.warning('Your seat hold expired');
          void refetch();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [selected.length === 0, refetch]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusOf = (s: SeatView): Status => live[s.label] ?? s.status;

  async function toggle(seat: SeatView) {
    const isSelected = selected.includes(seat.label);
    try {
      if (isSelected) {
        await api.post(`/seating/movies/${movieId}/release`, { labels: [seat.label] });
        setSelected((sel) => sel.filter((l) => l !== seat.label));
      } else {
        await api.post(`/seating/movies/${movieId}/hold`, { labels: [seat.label] });
        setSelected((sel) => [...sel, seat.label]);
        setSecondsLeft(HOLD_SECONDS); // hold (re)extended to 2 min
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Seat no longer available'));
      void refetch();
    }
  }

  async function confirm() {
    if (selected.length === 0) return;
    setBooking(true);
    try {
      await api.post(`/seating/movies/${movieId}/book`, {
        labels: selected,
        idempotencyKey: idemRef.current,
      });
      toast.success('Booked! Show your QR at the door.');
      navigate('/tickets');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not complete booking'));
      void refetch();
    } finally {
      setBooking(false);
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, SeatView[]>();
    data?.seats.forEach((s) => {
      if (!map.has(s.row)) map.set(s.row, []);
      map.get(s.row)!.push(s);
    });
    return [...map.entries()].map(([row, seats]) => ({ row, seats: seats.sort((a, b) => a.number - b.number) }));
  }, [data]);

  // ---- auth gate ----
  if (!user) {
    if (status === 'idle' || status === 'authenticating') {
      return <div className="px-4 pt-10 text-center text-sm text-muted">Loading…</div>;
    }
    return (
      <div className="flex flex-col items-center gap-3 px-4 pt-20 text-center">
        <p className="text-sm text-muted">Sign in to choose your seats.</p>
        <Button size="sm" onClick={openLogin}>
          Sign in
        </Button>
      </div>
    );
  }

  const mm = String(Math.floor(secondsLeft / 60)).padStart(1, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 items-center justify-between border-b border-border px-4">
        <button onClick={() => navigate('/')} className="text-sm text-muted">
          ‹ Back
        </button>
        <span className="text-sm font-medium">Select seats</span>
        <span className="w-10 text-right text-xs text-muted">
          {selected.length > 0 ? `${mm}:${ss}` : ''}
        </span>
      </header>

      <div className="flex-1 overflow-auto px-3 py-5">
        {isLoading && <LoadingState />}
        {isError && <ErrorState message={apiErrorMessage(error)} />}
        {data && data.seats.length === 0 && (
          <p className="py-16 text-center text-sm text-muted">
            Seats aren’t set up for this movie yet.
          </p>
        )}

        {data && data.seats.length > 0 && (
          <>
            {/* Screen + rows share one centered block so the screen is centred over the
                seats and scrolls with them when the layout is wide. */}
            <div className="mx-auto w-max">
              <div className="mb-6">
                <div className="h-1.5 rounded-full bg-fg/70" />
                <p className="mt-1 text-center text-[10px] uppercase tracking-widest text-muted">
                  Screen
                </p>
              </div>

              <div className="space-y-2">
                {grouped.map(({ row, seats }) => (
                  <div key={row} className="flex w-full items-center justify-center gap-2">
                    <span className="w-4 shrink-0 text-center text-[10px] font-medium text-muted">
                      {row}
                    </span>
                    <div className="flex gap-1.5">
                    {seats.map((seat) => {
                      const st = statusOf(seat);
                      const isMine = selected.includes(seat.label) || (seat.mine && st === 'HELD');
                      const taken = st === 'BOOKED' || (st === 'HELD' && !isMine);
                      const rankBlocked = st === 'FREE' && !seat.bookable && !isMine;
                      const disabled = taken || rankBlocked;
                      return (
                        <button
                          key={seat.label}
                          disabled={disabled}
                          onClick={() => toggle(seat)}
                          title={rankBlocked ? `Restricted to ${seat.allowedRanks.join('/')}` : seat.label}
                          className={cn(
                            'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[9px] font-medium transition-colors',
                            isMine && 'bg-accent text-white',
                            !isMine && st === 'FREE' && seat.bookable && 'border border-border bg-surface text-fg',
                            taken && 'bg-fg/80 text-bg',
                            rankBlocked && 'cursor-not-allowed border border-dashed border-border text-muted/50',
                          )}
                        >
                          {seat.number}
                        </button>
                      );
                    })}
                    </div>
                    <span className="w-4 shrink-0" />
                  </div>
                ))}
              </div>
            </div>

            {/* legend */}
            <div className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[10px] text-muted">
              <Legend cls="border border-border bg-surface" label="Available" />
              <Legend cls="bg-accent" label="Selected" />
              <Legend cls="bg-fg/80" label="Taken" />
              <Legend cls="border border-dashed border-border" label="Rank restricted" />
            </div>
          </>
        )}
      </div>

      {/* action bar */}
      <div className="border-t border-border bg-surface px-4 py-3">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="text-muted">
            {selected.length > 0 ? `${selected.length} seat(s): ${selected.join(', ')}` : 'No seats selected'}
          </span>
        </div>
        <Button className="w-full" disabled={selected.length === 0} loading={booking} onClick={confirm}>
          {selected.length > 0 ? `Confirm ${selected.length} seat(s)` : 'Select seats'}
        </Button>
      </div>
    </div>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn('h-3 w-3 rounded', cls)} /> {label}
    </span>
  );
}
