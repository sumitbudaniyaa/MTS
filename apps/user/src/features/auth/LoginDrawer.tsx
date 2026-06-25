import { useState } from 'react';
import { toast } from 'sonner';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { PasswordField } from '@/components/ui/PasswordField';
import { login } from './useAuth';
import { apiErrorMessage } from '@/lib/api';
import { useUiStore } from '@/stores/ui.store';

/** Bottom-drawer login — opened on demand (booking, viewing tickets, account button). */
export function LoginDrawer() {
  const { loginOpen, closeLogin } = useUiStore();
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{10}$/.test(mobile)) {
      toast.error('Enter a valid 10-digit mobile');
      return;
    }
    setBusy(true);
    try {
      await login(mobile, password);
      toast.success('Signed in');
      setMobile('');
      setPassword('');
      closeLogin();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Login failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={loginOpen} onClose={closeLogin} title="Sign in to continue">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="d-mobile">
            Mobile number
          </label>
          <input
            id="d-mobile"
            className="input"
            inputMode="numeric"
            autoComplete="username"
            placeholder="10-digit mobile"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
          />
        </div>
        <PasswordField
          label="Password"
          id="d-pass"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" className="w-full" loading={busy}>
          Sign in
        </Button>
      </form>
    </Sheet>
  );
}
