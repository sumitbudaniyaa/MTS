import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Film, ScanLine, Users, LogOut, UserCog } from 'lucide-react';
import { toast } from 'sonner';
import { logout as doLogout } from '@/features/auth/useAuth';
import { useAuthStore } from '@/stores/auth.store';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';

/**
 * Shell for the **operational ADMIN**: the person who actually runs shows, usually from a
 * phone at the venue. Two tabs (Movies, Scanners) + a scan button in the header that opens
 * a dedicated full-screen scan page with its own back button — keeping the pill compact and
 * giving the camera the full viewport.
 *
 * The full desktop console (units, personnel, admin accounts, auditorium, reports, audit,
 * timings) belongs to SUPER_ADMIN and is a different shell entirely — see `AppLayout`.
 */
const tabs = [
  { to: '/movies', label: 'Movies', icon: Film },
  { to: '/scanners', label: 'Scanners', icon: Users },
];

export function OpsLayout() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [account, setAccount] = useState(false);

  return (
    // pb leaves room for the fixed tab bar; `pb-safe` style inset keeps it clear of the iOS
    // home indicator.
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-surface/90 px-4 backdrop-blur">
        <span className="text-sm font-semibold text-fg">Auditorium Ops</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/scan')}
            aria-label="Scan tickets"
            title="Scan tickets"
            className="flex h-9 items-center gap-1.5 rounded-full bg-fg px-3.5 text-sm font-medium text-bg active:scale-95"
          >
            <ScanLine className="h-4 w-4" />
            Scan
          </button>
          <button
            type="button"
            onClick={() => setAccount(true)}
            aria-label="Account"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-muted active:scale-95"
          >
            <UserCog className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="px-4 py-5 pb-[calc(7rem+env(safe-area-inset-bottom))]">
        <Outlet />
      </main>

      {/* Floating pill nav, matching the user app. Padding is tighter than the user app's two
          tabs allow — three of these have to clear a 320px viewport. */}
      <nav
        className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2"
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center gap-1 rounded-full border border-border/70 bg-surface/80 p-1.5 shadow-[0_10px_30px_-8px_rgba(0,0,0,0.35)] ring-1 ring-black/5 backdrop-blur-xl">
          {tabs.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2.5 text-[13px] font-medium transition-all duration-200',
                  isActive
                    ? 'bg-fg text-bg shadow-sm'
                    : 'text-muted hover:bg-surface-2 hover:text-fg',
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>

      {account && <AccountSheet mobile={user?.mobile} onClose={() => setAccount(false)} />}
    </div>
  );
}

/**
 * The only account controls an operational admin needs. Settings as a page moved to
 * SUPER_ADMIN along with the timings it edited, but changing your own password and signing
 * out can never be someone else's job.
 */
function AccountSheet({ mobile, onClose }: { mobile?: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [changePassOpen, setChangePassOpen] = useState(false);

  return (
    <>
      <Modal open onClose={onClose} title="My account">
        <p className="mb-4 text-sm text-muted">
          Signed in as <span className="font-medium text-fg">{mobile ?? '—'}</span>
        </p>
        <div className="space-y-3">
          <Button className="w-full" onClick={() => setChangePassOpen(true)}>
            Change password
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            onClick={async () => {
              await doLogout();
              navigate('/login');
              toast.success('Signed out');
            }}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </Modal>

      {changePassOpen && (
        <ChangePasswordModal onClose={() => setChangePassOpen(false)} />
      )}
    </>
  );
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  async function changePassword() {
    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      toast.success('Password updated');
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Change password"
      loading={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!current || next.length < 8}
            onClick={() => void changePassword()}
          >
            Update password
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <PasswordInput
          label="Current password"
          value={current}
          disabled={busy}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <PasswordInput
          label="New password"
          value={next}
          disabled={busy}
          onChange={(e) => setNext(e.target.value)}
        />
        <p className="text-xs text-muted">Use at least 8 characters.</p>
      </div>
    </Modal>
  );
}
