import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Menu,
  Building2,
  Users,
  Film,
  Grid3x3,
  BarChart3,
  ScrollText,
  Settings,
  Moon,
  Sun,
  LogOut,
  Clapperboard,
  ChevronRight,
} from 'lucide-react';
import { useThemeStore } from '@/stores/theme.store';
import { useAuthStore } from '@/stores/auth.store';
import { logout } from '@/features/auth/useAuth';
import { useRole, roleLabel } from '@/lib/role';
import { cn } from '@/lib/cn';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Hide from super admins. Currently unused — kept as the hook for operational-only items. */
  adminOnly?: boolean;
}

// Grouping is presentational only. Seat allocation is deliberately NOT a nav item — it belongs
// to a movie, so it is reached from the movie (on create, and from the row action afterwards).
const navGroups: Array<{ label: string | null; items: NavItem[] }> = [
  {
    label: null,
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    label: 'Manage',
    items: [
      { to: '/units', label: 'Units', icon: Building2 },
      { to: '/scanners', label: 'Scanners', icon: Users },
      { to: '/movies', label: 'Movies', icon: Film },
      { to: '/auditorium', label: 'Auditorium', icon: Grid3x3 },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/reports', label: 'Reports', icon: BarChart3 },
      { to: '/audit', label: 'Audit Logs', icon: ScrollText },
    ],
  },
  {
    label: null,
    items: [{ to: '/settings', label: 'Settings', icon: Settings }],
  },
];

/** Flat lookup so the topbar can name the current page without duplicating the nav table. */
const titleByPath = new Map(
  navGroups.flatMap((g) => g.items).map((i) => [i.to, i.label] as const),
);

function useCrumb(): string {
  const { pathname } = useLocation();
  if (titleByPath.has(pathname)) return titleByPath.get(pathname)!;
  // Detail routes (e.g. /units/:id) fall back to their section.
  const section = `/${pathname.split('/')[1] ?? ''}`;
  return titleByPath.get(section) ?? 'Dashboard';
}

export function AppLayout() {
  const { theme, toggle } = useThemeStore();
  const user = useAuthStore((s) => s.user);
  const { isSuperAdmin } = useRole();
  const navigate = useNavigate();
  const crumb = useCrumb();
  const { pathname } = useLocation();
  // Below `lg` the sidebar becomes a slide-in drawer: 16rem of permanent chrome leaves a phone
  // almost no room for the tables this console is made of.
  const [navOpen, setNavOpen] = useState(false);
  // Close it on navigation, or it stays over the page you just asked for.
  useEffect(() => setNavOpen(false), [pathname]);

  const onLogout = async () => {
    await logout();
    navigate('/login');
  };

  const initials = (user?.name || user?.mobile || '?').trim().slice(0, 2).toUpperCase();

  return (
    <div className="flex h-full bg-bg">
      {/* Scrim — only present while the drawer is open, and only below lg. */}
      {navOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          'flex w-64 shrink-0 flex-col border-r border-border bg-surface',
          'fixed inset-y-0 left-0 z-50 transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0',
          navOpen ? 'translate-x-0 shadow-lift' : '-translate-x-full',
        )}
      >
        {/* Workspace mark */}
        <div className="p-3">
          <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5 shadow-soft">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-fg text-bg">
              <Clapperboard className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[11px] leading-tight text-muted">Admin Portal</p>
              <p className="truncate text-sm font-semibold leading-tight text-fg">Auditorium</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-3">
          {navGroups.map((group, gi) => {
            const items = group.items.filter((i) => !(i.adminOnly && isSuperAdmin));
            if (items.length === 0) return null;
            return (
              <div key={gi} className="space-y-1">
                {group.label && (
                  <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted">
                    {group.label}
                  </p>
                )}
                {items.map(({ to, label, icon: Icon, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition',
                        isActive
                          ? 'bg-surface-2 font-medium text-fg'
                          : 'font-normal text-muted hover:bg-surface-2/70 hover:text-fg',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon className={cn('h-4 w-4 shrink-0', isActive && 'text-accent')} />
                        {label}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        {/* Signed-in account */}
        <div className="p-3">
          <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5 shadow-soft">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-fg">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-tight text-fg">
                {user?.name || user?.mobile}
              </p>
              <p className="truncate text-[11px] leading-tight text-muted">{roleLabel(user?.role)}</p>
            </div>
            <button
              onClick={onLogout}
              className="rounded-lg p-1.5 text-muted transition hover:bg-surface-2 hover:text-fg"
              aria-label="Log out"
              title="Log out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 sm:px-6">
          <button
            onClick={() => setNavOpen(true)}
            className="-ml-1 rounded-lg p-2 text-muted transition hover:bg-surface-2 hover:text-fg lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
            {/* The dashboard is the root, so it isn't also its own parent. */}
            {crumb !== 'Dashboard' && (
              <>
                <span className="text-muted">Dashboard</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" />
              </>
            )}
            <span className="truncate font-medium text-fg">{crumb}</span>
          </nav>
          <button
            onClick={toggle}
            className="chip transition hover:bg-surface-2"
            aria-label="Toggle theme"
            title="Toggle theme"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </header>
        <main className="flex-1 overflow-auto bg-bg p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
