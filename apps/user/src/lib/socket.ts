import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '@/stores/auth.store';

// Where the socket lives.
//
// In production the REST API is proxied through this app's own origin (see vercel.json) so its
// refresh cookie is first-party — but a Vercel rewrite does NOT carry a WebSocket upgrade, so
// the socket has to reach the API host directly. That is safe cross-site: the handshake
// authenticates with the access token, not a cookie, so no third-party cookie is involved.
//
// `VITE_SOCKET_URL` is therefore REQUIRED in production (where VITE_API_URL is the relative
// `/api/v1`). In local dev it can be omitted — the API origin is derivable from VITE_API_URL.
const origin =
  import.meta.env.VITE_SOCKET_URL?.replace(/\/+$/, '') ||
  (import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/api\/v1\/?$/, '');

export function createSocket(): Socket {
  return io(origin || window.location.origin, {
    path: '/socket.io',
    withCredentials: true,
    // The server authenticates the handshake — send the current access token (re-read on every
    // (re)connect so a refreshed token is always used). Seat pages are only shown to logged-in
    // users, so a token is available.
    auth: (cb) => cb({ token: useAuthStore.getState().accessToken ?? '' }),
  });
}
