import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/stores/auth.store';

// Base API URL. Tolerates VITE_API_URL set with OR without the /api/v1 path.
const RAW_API = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';
const baseURL = /\/api\/v1\/?$/.test(RAW_API)
  ? RAW_API.replace(/\/+$/, '')
  : `${RAW_API.replace(/\/+$/, '')}/api/v1`;

/** Cookie-bearing axios instance (refresh token is an HttpOnly cookie). */
export const api: AxiosInstance = axios.create({ baseURL, withCredentials: true });

// Attach the in-memory access token to every request.
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Which app this is. Sent on /auth/refresh so the API reads THIS app's refresh cookie: the
// three apps share one cookie jar (cookies ignore port, and in production they share the API
// host), so a single cookie name would let whichever app logged in last evict the others.
const APP_ROLE = 'SCANNER';

// --- Transparent refresh on 401 ---------------------------------------------
// ONE in-flight refresh is shared by everything — the 401 interceptor AND the app-load
// bootstrap (see useAuthBootstrap). Deduping across both paths prevents two concurrent
// /auth/refresh calls from rotating the cookie twice and stranding an orphaned token.
export interface RefreshResult {
  accessToken: string;
  user: import('@/types').AuthUser;
}

let refreshing: Promise<RefreshResult | null> | null = null;

async function doRefresh(): Promise<RefreshResult | null> {
  try {
    const res = await axios.post<RefreshResult>(
      `${baseURL}/auth/refresh`,
      { role: APP_ROLE },
      { withCredentials: true },
    );
    useAuthStore.getState().setToken(res.data.accessToken);
    return res.data;
  } catch {
    return null;
  }
}

/** Shared, deduped session refresh. Returns the new token + user, or null on failure. */
export function refreshSession(): Promise<RefreshResult | null> {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    const status = error.response?.status;
    const isAuthRoute = original?.url?.includes('/auth/');

    if (status === 401 && original && !original._retried && !isAuthRoute) {
      original._retried = true;
      const result = await refreshSession();
      if (result) {
        original.headers.Authorization = `Bearer ${result.accessToken}`;
        return api(original);
      }
      useAuthStore.getState().clear();
    }
    return Promise.reject(error);
  },
);

/** Normalize backend error envelopes into a readable message for toasts. */
export function apiErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: { message?: string } } | undefined;
    return data?.error?.message ?? err.message ?? fallback;
  }
  return fallback;
}
