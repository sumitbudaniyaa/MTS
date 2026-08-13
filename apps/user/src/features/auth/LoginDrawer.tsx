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
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identity.trim()) {
      toast.error('Enter a valid mobile number or username');
      return;
    }
    setBusy(true);
    try {
      await login(identity.trim(), password);
      toast.success('Signed in');
      setIdentity('');
      setPassword('');
      closeLogin();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Login failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={loginOpen} onClose={closeLogin} title="Sign in to continue" loading={busy}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="d-mobile">
            Mobile number or Username
          </label>
          <input
            id="d-mobile"
            className="input"
            autoComplete="username"
            placeholder="Mobile or Username"
            value={identity}
            disabled={busy}
            onChange={(e) => setIdentity(e.target.value)}
          />
        </div>
        <PasswordField
          label="Password"
          id="d-pass"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          disabled={busy}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" className="w-full" loading={busy}>
          Sign in
        </Button>
      </form>
    </Sheet>
  );
}
