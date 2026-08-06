import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createSocket } from '@/lib/socket';
import { useAuthStore } from '@/stores/auth.store';
import type { Movie, MovieStatus, Paginated } from '@/types';

interface MovieUpdate {
  movieId: string;
  status?: MovieStatus;
  seatsBooked?: number;
  poolSeats?: number;
  openToAll?: boolean;
}

/**
 * Keeps the movie list honest without a reload.
 *
 * Most movie transitions are made by the cron jobs, not by a person: the booking window opens,
 * the pool is released at showtime, the show ends. An admin watching the list would otherwise
 * see a status frozen at whatever it was when the page loaded, which reads as the system having
 * stopped working.
 *
 * Patches the cached rows in place rather than invalidating, so a status change doesn't refetch
 * every page of the table — and a row whose seat count changes can't jump to a different page
 * under the reader's cursor.
 */
export function useLiveMovies(): void {
  const qc = useQueryClient();
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    if (status !== 'authenticated') return; // the handshake needs a live access token
    const socket = createSocket();
    socket.on('connect', () => socket.emit('admin:join'));

    socket.on('movie:update', ({ movieId, ...patch }: MovieUpdate) => {
      let matched = false;
      qc.setQueriesData<Paginated<Movie>>({ queryKey: ['movies'] }, (page) => {
        if (!page?.items.some((m) => m.id === movieId)) return page;
        matched = true;
        return {
          ...page,
          items: page.items.map((m) => (m.id === movieId ? { ...m, ...patch } : m)),
        };
      });
      // A movie we don't currently hold (another page, or a filter that now matches it) —
      // fall back to a refetch so it isn't silently missed.
      if (!matched) void qc.invalidateQueries({ queryKey: ['movies'] });
      // The dashboard shows the same counters; it is cheap and rarely mounted.
      void qc.invalidateQueries({ queryKey: ['overview'] });
    });

    return () => {
      socket.emit('admin:leave');
      socket.disconnect();
    };
  }, [qc, status]);
}
