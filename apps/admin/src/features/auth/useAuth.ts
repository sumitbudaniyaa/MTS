import { useEffect } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import type { AuthUser } from '@/types';

interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}

/** Silent re-auth on app load using the HttpOnly refresh cookie. */
export function useAuthBootstrap(): void {
  const { status, setAuth, setStatus } = useAuthStore();
  useEffect(() => {
    if (status !== 'idle') return;
    setStatus('authenticating');
    api
      .post<AuthResponse>('/auth/refresh')
      .then((res) => {
        if (res.data.user.role !== 'ADMIN') {
          useAuthStore.getState().clear();
          return;
        }
        setAuth(res.data.user, res.data.accessToken);
      })
      .catch(() => useAuthStore.getState().clear());
  }, [status, setAuth, setStatus]);
}

export async function login(mobile: string, password: string): Promise<AuthUser> {
  const res = await api.post<AuthResponse>('/auth/login', { mobile, password, role: 'ADMIN' });
  if (res.data.user.role !== 'ADMIN') {
    throw new Error('This portal is for administrators only');
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
