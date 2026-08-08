import { type ReactNode, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

const DURATION_MS = 260;

/**
 * Bottom sheet: dim backdrop + rounded panel that slides up.
 *
 * It stays mounted for one transition after `open` flips to false so the panel can animate
 * back down instead of vanishing, and keeps rendering the last children it was given while
 * doing so — a parent that clears its selection on close would otherwise blank the content
 * mid-animation.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  loading?: boolean;
}) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  // Last non-empty children, so the exit animation has something to render.
  const lastChildren = useRef<ReactNode>(children);
  if (open) lastChildren.current = children;

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Paint once in the closed position, then transition — otherwise the browser coalesces
      // both states and there is no animation at all. This needs *two* frames, not one: the
      // first rAF still runs before the paint of the frame the panel mounted in, so flipping
      // `shown` there lands both states in the same paint. The second guarantees the closed
      // position has actually been rendered before the transform changes.
      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setShown(true));
      });
      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
      };
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), DURATION_MS);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !loading && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mounted, onClose, loading]);

  // Don't let the page scroll behind the sheet.
  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mounted]);

  if (!mounted) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        className={
          'absolute inset-0 bg-black/40 backdrop-blur-[1px] transition-opacity duration-[260ms] ease-out ' +
          (shown ? 'opacity-100' : 'opacity-0')
        }
        onClick={loading ? undefined : onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className={
          'relative z-10 max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-2xl border-t border-border bg-surface p-5 pb-7 ' +
          'transition-transform duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none ' +
          (shown ? 'translate-y-0' : 'translate-y-full')
        }
      >
        <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-border" />
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          aria-label="Close"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-muted transition hover:text-fg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <X className="h-4 w-4" />
        </button>
        {title && <h2 className="mb-4 pr-10 text-sm font-semibold text-fg">{title}</h2>}
        {open ? children : lastChildren.current}
      </div>
    </div>
  );
}
