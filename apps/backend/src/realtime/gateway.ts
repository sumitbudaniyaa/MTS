import type { Server as HttpServer } from 'node:http';
import { Server as IOServer } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Real-time seat map. Clients join a per-movie room (`movie:<id>`) and receive `seats:update`
 * events whenever seats are held / released / booked, so every viewer sees live availability.
 */
let io: IOServer | null = null;

export function initRealtime(httpServer: HttpServer): void {
  io = new IOServer(httpServer, {
    cors: { origin: env.CORS_ORIGINS, credentials: true },
    path: '/socket.io',
  });

  io.on('connection', (socket) => {
    socket.on('movie:join', (movieId: unknown) => {
      if (typeof movieId === 'string' && /^[a-f\d]{24}$/i.test(movieId)) {
        void socket.join(`movie:${movieId}`);
      }
    });
    socket.on('movie:leave', (movieId: unknown) => {
      if (typeof movieId === 'string') void socket.leave(`movie:${movieId}`);
    });
  });

  logger.info('[realtime] socket.io initialized');
}

/** Payload describing one or more seats that changed state. */
export interface SeatUpdate {
  label: string;
  status: 'FREE' | 'HELD' | 'BOOKED';
}

/** Broadcast seat changes to everyone viewing a movie's seat map. */
export function broadcastSeats(movieId: string, seats: SeatUpdate[]): void {
  io?.to(`movie:${movieId}`).emit('seats:update', { movieId, seats });
}
