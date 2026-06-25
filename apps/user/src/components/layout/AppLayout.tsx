import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Clapperboard, Ticket } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { LoginDrawer } from '@/features/auth/LoginDrawer';
import { cn } from '@/lib/cn';

const tabs = [
  { to: '/', label: 'Movies', icon: Clapperboard, end: true },
  { to: '/tickets', label: 'Tickets', icon: Ticket, end: false },
];

export function AppLayout() {
  const user = useAuthStore((s) => s.user);
  const openLogin = useUiStore((s) => s.openLogin);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // The pill nav is a primary-navigation affordance; hide it on secondary/full-screen pages.
  const showPill = pathname !== '/profile' && !pathname.startsWith('/book');
  const fullScreen = pathname.startsWith('/book');

  return (
    <div className="relative mx-auto flex h-full max-w-md flex-col bg-bg">
      {/* Header: brand text on the left, single account button on the right. Hidden on
          full-screen flows like the seat picker (which has its own header). */}
      {!fullScreen && (
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-bg/90 px-4 backdrop-blur">
          <span className="text-sm font-semibold tracking-tight">Auditorium</span>
          {user ? (
            <button
              onClick={() => navigate('/profile')}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-fg text-xs font-semibold text-bg"
              aria-label="Account"
            >
              {(user.name || user.mobile).charAt(0).toUpperCase()}
            </button>
          ) : (
            <button
              onClick={openLogin}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-fg hover:bg-surface-2"
            >
              Sign in
            </button>
          )}
        </header>
      )}

      <main className={cn('flex-1 overflow-auto', fullScreen ? '' : showPill ? 'pb-24' : 'pb-6')}>
        <Outlet />
      </main>

      {/* Floating pill nav — primary navigation only. */}
      {showPill && (
        <nav className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2">
          <div className="flex items-center gap-1 rounded-full border border-border/70 bg-surface/80 p-1.5 shadow-[0_10px_30px_-8px_rgba(0,0,0,0.35)] ring-1 ring-black/5 backdrop-blur-xl">
            {tabs.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-all duration-200',
                    isActive
                      ? 'bg-fg text-bg shadow-sm'
                      : 'text-muted hover:bg-surface-2 hover:text-fg',
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </div>
        </nav>
      )}

      <LoginDrawer />
    </div>
  );
}
