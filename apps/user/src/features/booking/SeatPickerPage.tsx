import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';
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

/**
 * Seat-map geometry at zoom 1, in px. Zoom scales these values rather than applying a CSS
 * transform: the layout reflows, so the scroll container's extents stay correct for free and
 * seat numbers stay crisp at every level instead of turning into blurred bitmaps.
 */
const SEAT_PX = 28;
const GAP_PX = 6;
const RAIL_PX = 18; // row-label gutter, one each side
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.4;

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Natural width of the widest row at zoom 1 — the basis for the initial fit-to-width. */
function naturalWidth(maxSeatsInRow: number): number {
  return 2 * RAIL_PX + 2 * GAP_PX + maxSeatsInRow * SEAT_PX + (maxSeatsInRow - 1) * GAP_PX;
}

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
  // Seats with an in-flight hold/release — blocks rapid double-taps from firing twice.
  const pendingRef = useRef<Set<string>>(new Set());

  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Mirrors `zoom` for the gesture listeners, which are bound once and would otherwise
  // capture a stale value.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const fittedRef = useRef<string | undefined>(undefined);

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
    // Ignore repeat taps on a seat that already has a hold/release in flight.
    if (pendingRef.current.has(seat.label)) return;
    pendingRef.current.add(seat.label);
    const isSelected = selected.includes(seat.label);
    try {
      if (isSelected) {
        await api.post(`/seating/movies/${movieId}/release`, { labels: [seat.label] });
        setSelected((sel) => sel.filter((l) => l !== seat.label));
      } else {
        await api.post(`/seating/movies/${movieId}/hold`, { labels: [seat.label] });
        setSelected((sel) => (sel.includes(seat.label) ? sel : [...sel, seat.label]));
        setSecondsLeft(HOLD_SECONDS); // hold (re)extended to 2 min
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Seat no longer available'));
      void refetch();
    } finally {
      pendingRef.current.delete(seat.label);
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

  const widestRow = useMemo(
    () => grouped.reduce((max, g) => Math.max(max, g.seats.length), 0),
    [grouped],
  );

  // Start at whatever zoom shows the whole auditorium — an unscaled 20-seat row is ~700px and
  // would open half off-screen on a phone. Only ever shrinks: a narrow layout stays at 1:1.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || widestRow === 0 || fittedRef.current === movieId) return;
    fittedRef.current = movieId;
    const available = el.clientWidth - 24; // px-3 either side
    setZoom(clampZoom(Math.min(1, available / naturalWidth(widestRow))));
  }, [widestRow, movieId]);

  // Pinch to zoom, and ctrl/⌘+wheel (what a trackpad pinch sends) on desktop. Bound by hand
  // rather than via React props because both need `preventDefault`, and React registers
  // touchmove/wheel as passive listeners at the root, where preventDefault is a no-op.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let startDist = 0;
    let startZoom = 1;
    const spread = (t: TouchList) =>
      Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      startDist = spread(e.touches);
      startZoom = zoomRef.current;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || startDist === 0) return;
      e.preventDefault(); // otherwise the container pans while the fingers are still pinching
      setZoom(clampZoom(startZoom * (spread(e.touches) / startDist)));
    };
    const onTouchEnd = () => {
      startDist = 0;
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // a plain wheel should still scroll the map
      e.preventDefault();
      setZoom(clampZoom(zoomRef.current - e.deltaY * 0.003));
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  const fitToWidth = useCallback(() => {
    const el = scrollRef.current;
    if (!el || widestRow === 0) return;
    setZoom(clampZoom(Math.min(1, (el.clientWidth - 24) / naturalWidth(widestRow))));
  }, [widestRow]);

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

      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} className="h-full overflow-auto overscroll-contain px-3 py-5">
          {isLoading && <LoadingState />}
          {isError && <ErrorState message={apiErrorMessage(error)} />}
          {data && data.seats.length === 0 && (
            <p className="py-16 text-center text-sm text-muted">
              Seats aren’t set up for this movie yet.
            </p>
          )}

          {data && data.seats.length > 0 && (
            <>
              {/* Screen + rows share one centred block so the screen spans exactly the seat
                  area and scrolls with it when the layout is zoomed in past the viewport. */}
              <div
                className="mx-auto w-max"
                style={
                  {
                    '--seat': `${SEAT_PX * zoom}px`,
                    '--gap': `${GAP_PX * zoom}px`,
                    '--rail': `${RAIL_PX * zoom}px`,
                    '--seat-fs': `${Math.max(7, 9.5 * zoom)}px`,
                  } as CSSProperties
                }
              >
                <Screen />

                <div className="flex flex-col" style={{ gap: 'var(--gap)' }}>
                  {grouped.map(({ row, seats }) => (
                    <div
                      key={row}
                      className="flex items-center justify-center"
                      style={{ gap: 'var(--gap)' }}
                    >
                      <RowLabel>{row}</RowLabel>
                      <div className="flex" style={{ gap: 'var(--gap)' }}>
                        {seats.map((seat) => {
                          const st = statusOf(seat);
                          const isMine =
                            selected.includes(seat.label) || (seat.mine && st === 'HELD');
                          const taken = st === 'BOOKED' || (st === 'HELD' && !isMine);
                          const rankBlocked = st === 'FREE' && !seat.bookable && !isMine;
                          const disabled = taken || rankBlocked;
                          return (
                            <button
                              key={seat.label}
                              disabled={disabled}
                              onClick={() => toggle(seat)}
                              title={
                                rankBlocked
                                  ? `Restricted to ${seat.allowedRanks.join('/')}`
                                  : seat.label
                              }
                              style={{
                                width: 'var(--seat)',
                                height: 'var(--seat)',
                                fontSize: 'var(--seat-fs)',
                              }}
                              className={cn(
                                // Rounded shoulders + a flat base reads as a seat rather than
                                // a checkbox once a few hundred are tiled together.
                                'flex shrink-0 items-center justify-center rounded-t-[40%] rounded-b-[20%] font-medium leading-none transition-all',
                                isMine &&
                                  'scale-105 bg-accent text-white shadow-md shadow-accent/30 ring-1 ring-accent',
                                !isMine &&
                                  st === 'FREE' &&
                                  seat.bookable &&
                                  'border border-border bg-surface text-fg active:scale-95',
                                taken && 'cursor-not-allowed bg-fg/25 text-fg/40',
                                rankBlocked &&
                                  'cursor-not-allowed border border-dashed border-border text-muted/50',
                              )}
                            >
                              {seat.number}
                            </button>
                          );
                        })}
                      </div>
                      <RowLabel>{row}</RowLabel>
                    </div>
                  ))}
                </div>
              </div>

              {/* legend */}
              <div className="mt-7 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[10px] text-muted">
                <Legend cls="border border-border bg-surface" label="Available" />
                <Legend cls="bg-accent" label="Selected" />
                <Legend cls="bg-fg/25" label="Taken" />
                <Legend cls="border border-dashed border-border" label="Rank restricted" />
              </div>
            </>
          )}
        </div>

        {data && data.seats.length > 0 && (
          <div className="pointer-events-none absolute bottom-3 right-3 flex flex-col items-center overflow-hidden rounded-full border border-border bg-surface/95 shadow-lg backdrop-blur">
            <ZoomButton label="Zoom in" onClick={() => setZoom((z) => clampZoom(z + 0.2))}>
              <Plus className="h-4 w-4" />
            </ZoomButton>
            <button
              type="button"
              onClick={fitToWidth}
              title="Fit to width"
              className="pointer-events-auto w-full border-y border-border px-1 py-1 text-[10px] font-medium tabular-nums text-muted active:bg-surface-2"
            >
              {Math.round(zoom * 100)}%
            </button>
            <ZoomButton label="Zoom out" onClick={() => setZoom((z) => clampZoom(z - 0.2))}>
              <Minus className="h-4 w-4" />
            </ZoomButton>
          </div>
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
      <span className={cn('h-3 w-3 rounded-t-[40%] rounded-b-[20%]', cls)} /> {label}
    </span>
  );
}

/**
 * The screen: a curved bar spanning the full seat block (`w-full` inside the `w-max` parent,
 * so it matches the widest row exactly at any zoom) with the light it throws over the front
 * rows fading out beneath it.
 */
function Screen() {
  return (
    <div className="mb-7 select-none">
      <div className="h-2 w-full rounded-[50%] bg-gradient-to-b from-fg/70 to-fg/40" />
      <div className="mx-auto h-8 w-[94%] rounded-b-[50%] bg-gradient-to-b from-fg/[0.07] to-transparent" />
      <p className="-mt-5 text-center text-[10px] uppercase tracking-[0.35em] text-muted">
        Screen
      </p>
    </div>
  );
}

/** Row letter in the gutter, sized with the seats so it stays proportional while zooming. */
function RowLabel({ children }: { children: ReactNode }) {
  return (
    <span
      className="shrink-0 text-center font-medium text-muted"
      style={{ width: 'var(--rail)', fontSize: 'var(--seat-fs)' }}
    >
      {children}
    </span>
  );
}

function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="pointer-events-auto flex h-9 w-9 items-center justify-center text-fg active:bg-surface-2"
    >
      {children}
    </button>
  );
}
