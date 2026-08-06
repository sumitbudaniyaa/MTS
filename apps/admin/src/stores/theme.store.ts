import { create } from 'zustand';

type Theme = 'light' | 'dark';

function initial(): Theme {
  const saved = localStorage.getItem('admin-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  // Light by default. The OS preference is deliberately NOT followed — the portal is designed
  // light-first, and an admin who wants dark can toggle it (the choice then persists).
  return 'light';
}

function apply(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  localStorage.setItem('admin-theme', theme);
}

interface ThemeState {
  theme: Theme;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const theme = initial();
  apply(theme);
  return {
    theme,
    toggle: () => {
      const next = get().theme === 'dark' ? 'light' : 'dark';
      apply(next);
      set({ theme: next });
    },
  };
});
