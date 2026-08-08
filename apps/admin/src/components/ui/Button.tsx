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

// Soft-SaaS: pill-rounded, hairline-lifted, black primary against white secondaries.
const variants: Record<Variant, string> = {
  primary: 'bg-fg text-bg shadow-soft hover:bg-fg/90',
  secondary: 'border border-border bg-surface text-fg shadow-soft hover:bg-surface-2',
  ghost: 'text-muted hover:bg-surface-2 hover:text-fg',
  danger: 'bg-danger text-white shadow-soft hover:bg-danger/90',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
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
        'relative inline-flex items-center justify-center whitespace-nowrap rounded-xl font-medium transition disabled:cursor-not-allowed disabled:shadow-none',
        // A button that is *working* shouldn't look unavailable. Only dim when it is genuinely
        // disabled — dimming on `loading` made "Create" grey out the moment you pressed it.
        disabled && !loading && 'opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {/* The spinner is absolutely positioned and the label keeps its space (invisible, not
          removed), so the button cannot change width while it works. It used to be *prepended*,
          which widened the button by the icon plus the gap the instant it was pressed and shoved
          its neighbours — most visibly the Cancel button next to it in a dialog footer. */}
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
