import { useAuthStore } from '@/stores/auth.store';

/**
 * Nudge for an account still holding a password an admin set (the shared starter password, or a
 * reset). The account works normally inside the grace window — this is the reminder — and the API
 * refuses everything but reading yourself and changing your password once the deadline passes.
 * Shown persistently rather than as a toast because it is a standing obligation, not an event.
 */
export function TempPasswordBanner({ onChangePassword }: { onChangePassword?: () => void }) {
  const user = useAuthStore((s) => s.user);
  if (!user?.mustChangePassword) return null;

  const expiresAt = user.passwordExpiresAt ? new Date(user.passwordExpiresAt) : null;
  const daysLeft = expiresAt ? Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000) : null;
  const expired = daysLeft !== null && daysLeft <= 0;

  return (
    <div
      className={`border-b px-4 py-2.5 text-xs ${
        expired ? 'border-danger/30 bg-danger/10' : 'border-warning/30 bg-warning/10'
      }`}
    >
      <p className="font-medium text-fg">
        {expired
          ? 'Your temporary password has expired.'
          : `Change your temporary password${daysLeft !== null ? ` within ${daysLeft} day${daysLeft === 1 ? '' : 's'}` : ''}.`}
      </p>
      <p className="mt-0.5 text-muted">
        {expired
          ? 'Set a new password to use the app again.'
          : 'It was set for you, so it is not private to you.'}
        {onChangePassword && (
          <button
            type="button"
            onClick={onChangePassword}
            className="ml-1 font-medium text-accent underline"
          >
            Change it now
          </button>
        )}
      </p>
    </div>
  );
}
