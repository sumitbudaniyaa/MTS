import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createSocket } from '@/lib/socket';
import { useAuthStore } from '@/stores/auth.store';

/**
 * Keeps the per-movie detail dialog live while it is open — seat map, who booked what, the
 * counters and the per-unit allocation table.
 *
 * An admin opens this precisely when they want to watch a show fill up, so a snapshot frozen at
 * open time is the wrong thing to show. It listens on two channels: `seats:update` for the
 * movie's own room (every hold, release, book and no-show reclaim) and `movie:update` for the
 * admin feed (status and seat counters moved by the cron jobs).
 *
 * Both are coalesced into a single refetch on a short timer. The detail payload is the whole
 * auditorium — seats, bookings and allocations — and a busy show emits a burst of seat events,
 * so refetching per event would pull hundreds of rows repeatedly for one visible change.
 */
const COALESCE_MS = 400;

export function useLiveMovieDetail(movieId: string | undefined): void {
  const qc = useQueryClient();
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    // The handshake is authenticated, so there is no point connecting without a live token.
    if (!movieId || status !== 'authenticated') return;

    const socket = createSocket();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      if (timer) return; // a refetch is already queued — let it cover this event too
      timer = setTimeout(() => {
        timer = null;
        void qc.invalidateQueries({ queryKey: ['movie-detail', movieId] });
      }, COALESCE_MS);
    };

    socket.on('connect', () => {
      socket.emit('movie:join', movieId);
      // Also the admin feed, for the counters and status the jobs move.
      socket.emit('admin:join');
    });
    socket.on('seats:update', (p: { movieId: string }) => {
      if (p.movieId === movieId) refresh();
    });
    socket.on('movie:update', (p: { movieId: string }) => {
      if (p.movieId === movieId) refresh();
    });

    return () => {
      if (timer) clearTimeout(timer);
      socket.emit('movie:leave', movieId);
      socket.disconnect();
    };
  }, [movieId, status, qc]);
}
