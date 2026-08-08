import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

// Minimal, modern: compact, lightly rounded, subtle.
const variants: Record<Variant, string> = {
  primary: 'bg-fg text-bg hover:opacity-90',
  secondary: 'border border-border bg-surface text-fg hover:bg-surface-2',
  ghost: 'text-muted hover:bg-surface-2 hover:text-fg',
  danger: 'bg-danger text-white hover:opacity-90',
};

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-9 px-3.5 text-sm',
};

// The gap belongs to the label wrapper, not the button, because the spinner is overlaid rather
// than laid out — see below.
const gaps: Record<Size, string> = {
  sm: 'gap-1.5',
  md: 'gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, disabled, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'relative inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors disabled:cursor-not-allowed',
        // A button that is *working* shouldn't look unavailable — only dim when genuinely disabled.
        disabled && !loading && 'opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {/* Spinner overlaid, label kept in place but invisible: the button cannot change width
          while it works. Prepending the spinner widened it the instant it was pressed and shoved
          whatever sat beside it — most visibly a Cancel button in a dialog footer. */}
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
          <Loader2 className="h-4 w-4 animate-spin" />
        </span>
      )}
      <span className={cn('inline-flex items-center', gaps[size], loading && 'invisible')}>
        {children}
      </span>
    </button>
  );
});
