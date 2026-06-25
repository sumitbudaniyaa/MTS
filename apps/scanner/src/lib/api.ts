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

// --- Transparent refresh on 401 ---------------------------------------------
// A single in-flight refresh is shared by all queued requests to avoid stampedes.
let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await axios.post<{ accessToken: string; user: unknown }>(
      `${baseURL}/auth/refresh`,
      {},
      { withCredentials: true },
    );
    const token = res.data.accessToken;
    useAuthStore.getState().setToken(token);
    return token;
  } catch {
    useAuthStore.getState().clear();
    return null;
  }
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    const status = error.response?.status;
    const isAuthRoute = original?.url?.includes('/auth/');

    if (status === 401 && original && !original._retried && !isAuthRoute) {
      original._retried = true;
      refreshing ??= refreshAccessToken().finally(() => {
        refreshing = null;
      });
      const token = await refreshing;
      if (token) {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      }
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
