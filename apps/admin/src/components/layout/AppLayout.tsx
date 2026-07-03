import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  Users,
  Film,
  LayoutGrid,
  Grid3x3,
  BarChart3,
  ScrollText,
  Settings,
  Moon,
  Sun,
  LogOut,
} from 'lucide-react';
import { useThemeStore } from '@/stores/theme.store';
import { useAuthStore } from '@/stores/auth.store';
import { logout } from '@/features/auth/useAuth';
import { useRole, roleLabel } from '@/lib/role';
import { cn } from '@/lib/cn';

// `adminOnly` items are hidden from super admins (movie seat allocation is operational-admin only).
const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/units', label: 'Units', icon: Building2 },
  { to: '/scanners', label: 'Scanners', icon: Users },
  { to: '/movies', label: 'Movies', icon: Film },
  { to: '/auditorium', label: 'Auditorium', icon: Grid3x3 },
  { to: '/allocations', label: 'Seat Allocation', icon: LayoutGrid, adminOnly: true },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/audit', label: 'Audit Logs', icon: ScrollText },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function AppLayout() {
  const { theme, toggle } = useThemeStore();
  const user = useAuthStore((s) => s.user);
  const { isSuperAdmin } = useRole();
  const navigate = useNavigate();
  const visibleNav = nav.filter((item) => !(item.adminOnly && isSuperAdmin));

  const onLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex h-full">
      <aside className="flex w-60 flex-col border-r border-border bg-surface">
        <div className="flex h-14 items-center border-b border-border px-5">
          <span className="text-sm font-semibold tracking-tight">Auditorium</span>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {visibleNav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition',
                  isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        
        {/* Bottom User Info & Logout */}
        <div className="border-t border-border p-4">
          <div className="flex items-center justify-between">
            <div className="flex flex-col overflow-hidden">
              <span className="truncate text-sm font-medium text-fg">
                {user?.name || user?.mobile}
              </span>
              <span className="text-xs text-muted">{roleLabel(user?.role)}</span>
            </div>
            <button
              onClick={onLogout}
              className="rounded-md p-2 text-muted transition hover:bg-surface-2 hover:text-fg"
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
        <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-6">
          <div className="text-sm font-medium text-fg">Admin Portal</div>
          <button
            onClick={toggle}
            className="rounded-md p-2 text-muted transition hover:bg-surface-2 hover:text-fg"
            aria-label="Toggle theme"
            title="Toggle theme"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </header>
        <main className="flex-1 overflow-auto p-6 bg-bg">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
