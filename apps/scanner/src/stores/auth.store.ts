import { create } from 'zustand';
import type { AuthUser } from '@/types';

type AuthStatus = 'idle' | 'authenticating' | 'authenticated' | 'unauthenticated';

interface AuthState {
  user: AuthUser | null;
  // Access token is kept in memory only (never persisted) — the refresh token lives in an
  // HttpOnly cookie. On reload we silently re-auth via /auth/refresh.
  accessToken: string | null;
  status: AuthStatus;
  setAuth: (user: AuthUser, accessToken: string) => void;
  setToken: (accessToken: string) => void;
  setStatus: (status: AuthStatus) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  status: 'idle',
  setAuth: (user, accessToken) => set({ user, accessToken, status: 'authenticated' }),
  setToken: (accessToken) => set({ accessToken }),
  setStatus: (status) => set({ status }),
  clear: () => set({ user: null, accessToken: null, status: 'unauthenticated' }),
}));
