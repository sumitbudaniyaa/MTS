import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { App } from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 0, refetchOnWindowFocus: false } },
});

// NOTE: no React.StrictMode — its dev double-mount restarts the camera mid-init and the
// html5-qrcode stream gets stuck (black screen). Production is unaffected either way.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <App />
    <Toaster theme="light" richColors position="top-center" />
  </QueryClientProvider>,
);
