import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api, apiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { PasswordField } from '@/components/ui/PasswordField';
import { logout } from '@/features/auth/useAuth';
import { useAuthStore } from '@/stores/auth.store';

export function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const navigate = useNavigate();
  const [changing, setChanging] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  // Wait for silent re-auth to settle before deciding to bounce.
  if (!user && (status === 'idle' || status === 'authenticating')) {
    return <div className="px-4 pt-10 text-center text-sm text-muted">Loading…</div>;
  }
  if (!user) return <Navigate to="/" replace />;

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 6) {
      toast.error('New password must be at least 6 characters');
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      toast.success('Password updated');
      setCurrent('');
      setNext('');
      setChanging(false);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not change password'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 pt-5">
      <button
        onClick={() => navigate(-1)}
        className="mb-3 -ml-1 inline-flex items-center text-sm text-muted hover:text-fg"
      >
        ‹ Back
      </button>
      <h1 className="mb-5 text-lg font-semibold tracking-tight">Account</h1>

      <div className="card mb-4 flex items-center gap-3 p-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-fg text-sm font-semibold text-bg">
          {(user.name || user.mobile).charAt(0).toUpperCase()}
        </div>
        <div>
          <div className="text-sm font-medium">{user.name || 'Service member'}</div>
          <div className="text-xs text-muted">{user.mobile}</div>
        </div>
      </div>

      {!changing ? (
        <div className="space-y-2">
          <Button variant="secondary" className="w-full" onClick={() => setChanging(true)}>
            Change password
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={async () => {
              await logout();
              navigate('/');
              toast.success('Signed out');
            }}
          >
            Sign out
          </Button>
        </div>
      ) : (
        <form onSubmit={submitPassword} className="card space-y-3 p-4">
          <PasswordField
            label="Current password"
            id="cur-pass"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <PasswordField
            label="New password"
            id="new-pass"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setChanging(false)}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" loading={busy}>
              Update
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
