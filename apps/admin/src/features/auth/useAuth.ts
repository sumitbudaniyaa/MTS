import { useEffect } from 'react';
import { api, refreshSession } from '@/lib/api';
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
    void refreshSession().then((result) => {
      if (result && (result.user.role === 'ADMIN' || result.user.role === 'SUPER_ADMIN')) {
        setAuth(result.user, result.accessToken);
      } else {
        useAuthStore.getState().clear();
      }
    });
  }, [status, setAuth, setStatus]);
}

export async function login(mobile: string, password: string): Promise<AuthUser> {
  // role=ADMIN scopes the lookup to the admins collection; the account may be ADMIN or
  // SUPER_ADMIN and both are allowed into this portal.
  const res = await api.post<AuthResponse>('/auth/login', { mobile, password, role: 'ADMIN' });
  if (res.data.user.role !== 'ADMIN' && res.data.user.role !== 'SUPER_ADMIN') {
    throw new Error('This portal is for administrators only');
  }
  useAuthStore.getState().setAuth(res.data.user, res.data.accessToken);
  return res.data.user;
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout', { role: 'ADMIN' });
  } finally {
    useAuthStore.getState().clear();
  }
}
