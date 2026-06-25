import { io, type Socket } from 'socket.io-client';

// The API base is e.g. http://localhost:4000/api/v1 — socket.io lives at the origin root.
const origin = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1').replace(
  /\/api\/v1\/?$/,
  '',
);

export function createSocket(): Socket {
  return io(origin || window.location.origin, {
    path: '/socket.io',
    withCredentials: true,
  });
}
