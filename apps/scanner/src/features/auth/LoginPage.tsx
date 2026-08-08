import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { PasswordField } from '@/components/ui/PasswordField';
import { login } from './useAuth';
import { apiErrorMessage } from '@/lib/api';
import { onlyDigits10 } from '@/lib/mobile';

export function LoginPage() {
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(mobile, password);
      toast.success('Ready to scan');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Login failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-lg font-semibold tracking-tight">Scanner</h1>
          <p className="mt-1 text-xs text-muted">Verify tickets at the door</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="mobile">
              Mobile number
            </label>
            <input
              id="mobile"
              className="input"
              inputMode="numeric"
              maxLength={10}
              placeholder="10-digit mobile"
              value={mobile}
              disabled={busy}
              onChange={(e) => setMobile(onlyDigits10(e.target.value))}
            />
          </div>
          <PasswordField
            label="Password"
            id="password"
            placeholder="••••••••"
            value={password}
            disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" className="w-full" loading={busy}>
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
