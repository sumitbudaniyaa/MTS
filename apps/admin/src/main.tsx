import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { App } from './App';
import { useThemeStore } from '@/stores/theme.store';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

function Root() {
  const theme = useThemeStore((s) => s.theme);
  return (
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster theme={theme} richColors position="top-right" />
    </QueryClientProvider>
  );
}

// No React.StrictMode — its dev double-mount fires two concurrent /auth/refresh calls,
// which tripped refresh-token rotation and logged the user out on reload.
ReactDOM.createRoot(document.getElementById('root')!).render(<Root />);
