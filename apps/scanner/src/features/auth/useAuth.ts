import { useEffect } from 'react';
import { api, refreshSession } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import type { AuthUser } from '@/types';

interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}

/** Silent re-auth on load using the HttpOnly refresh cookie. */
export function useAuthBootstrap(): void {
  const { status, setAuth, setStatus } = useAuthStore();
  useEffect(() => {
    if (status !== 'idle') return;
    setStatus('authenticating');
    void refreshSession().then((result) => {
      if (result && result.user.role === 'SCANNER') {
        setAuth(result.user, result.accessToken);
      } else {
        useAuthStore.getState().clear();
      }
    });
  }, [status, setAuth, setStatus]);
}

export async function login(mobile: string, password: string): Promise<AuthUser> {
  const res = await api.post<AuthResponse>('/auth/login', { mobile, password, role: 'SCANNER' });
  if (res.data.user.role !== 'SCANNER') {
    throw new Error('This app is for scanner operators only');
  }
  useAuthStore.getState().setAuth(res.data.user, res.data.accessToken);
  return res.data.user;
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout', { role: 'SCANNER' });
  } finally {
    useAuthStore.getState().clear();
  }
}
