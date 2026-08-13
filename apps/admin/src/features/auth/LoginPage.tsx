import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Input } from '@/components/ui/Input';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { Button } from '@/components/ui/Button';
import { login } from './useAuth';
import { apiErrorMessage } from '@/lib/api';

interface FormValues {
  identity: string;
  password: string;
}

export function LoginPage() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login(values.identity.trim(), values.password);
      toast.success('Welcome back');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Login failed'));
    }
  });

  return (
    <div className="flex min-h-full items-center justify-center bg-bg p-4">
      <div className="card w-full max-w-sm p-8">
        <div className="mb-6 text-center">
          <h1 className="text-base font-semibold tracking-tight text-fg">Auditorium Admin</h1>
          <p className="mt-1 text-xs text-muted">Sign in to manage bookings</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <Input
            label="Mobile number or Username"
            id="identity"
            placeholder="Mobile or Username"
            error={errors.identity?.message}
            disabled={isSubmitting}
            {...register('identity', {
              required: 'Mobile or Username is required',
            })}
          />
          <PasswordInput
            label="Password"
            id="password"
            placeholder="••••••••"
            error={errors.password?.message}
            disabled={isSubmitting}
            {...register('password', { required: 'Password is required' })}
          />
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
