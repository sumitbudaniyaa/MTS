import { useEffect } from 'react';
import { api, refreshSession } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import type { AuthUser } from '@/types';

interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}

/**
 * Silent re-auth on load using the HttpOnly refresh cookie. Goes through the SHARED
 * `refreshSession()` so it can never race the 401 interceptor's refresh (which would rotate
 * the cookie twice and log the user out on the next reload).
 */
export function useAuthBootstrap(): void {
  const { status, setAuth, setStatus } = useAuthStore();
  useEffect(() => {
    if (status !== 'idle') return;
    setStatus('authenticating');
    void refreshSession().then((result) => {
      if (result && result.user.role === 'USER') {
        setAuth(result.user, result.accessToken);
      } else {
        useAuthStore.getState().clear();
      }
    });
  }, [status, setAuth, setStatus]);
}

export async function login(mobile: string, password: string): Promise<AuthUser> {
  const res = await api.post<AuthResponse>('/auth/login', { mobile, password, role: 'USER' });
  if (res.data.user.role !== 'USER') {
    throw new Error('This app is for service members only');
  }
  useAuthStore.getState().setAuth(res.data.user, res.data.accessToken);
  return res.data.user;
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout');
  } finally {
    useAuthStore.getState().clear();
  }
}
