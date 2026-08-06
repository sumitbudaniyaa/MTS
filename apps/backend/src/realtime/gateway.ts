import type { Server as HttpServer } from 'node:http';
import { Server as IOServer } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { Roles } from '../types/index.js';

/** Room every admin console joins to watch movies change state in real time. */
const ADMIN_ROOM = 'admin:movies';

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

  // Authenticated handshake: the client passes its access token in `auth.token`. Rejecting
  // unauthenticated sockets keeps the live seat map from being observed by anonymous clients.
  io.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    if (typeof token !== 'string' || token.length === 0) {
      return next(new Error('unauthorized'));
    }
    try {
      const principal = verifyAccessToken(token);
      // Kept for the admin room below: the seat map is fine for any signed-in user, but the
      // admin feed carries operational counters and must not be joinable by one.
      socket.data.role = principal.role;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
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

    // Admin console feed: movie status and seat counters, for every movie at once.
    socket.on('admin:join', () => {
      const role = socket.data.role as string | undefined;
      if (role === Roles.ADMIN || role === Roles.SUPER_ADMIN) void socket.join(ADMIN_ROOM);
    });
    socket.on('admin:leave', () => void socket.leave(ADMIN_ROOM));
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

/** Fields of a movie an admin console cares about seeing change without reloading. */
export interface MovieUpdate {
  status?: string;
  seatsBooked?: number;
  poolSeats?: number;
  openToAll?: boolean;
}

/**
 * Tell every open admin console that a movie changed.
 *
 * Most of these transitions are made by the cron jobs rather than by a person, so without this
 * an admin watching the list sees a stale status until they happen to reload — the show starts,
 * the badge doesn't move, and the page quietly lies about what the system is doing.
 */
export function broadcastMovie(movieId: string, patch: MovieUpdate): void {
  io?.to(ADMIN_ROOM).emit('movie:update', { movieId, ...patch });
}
