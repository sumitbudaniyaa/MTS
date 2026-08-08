import { useCallback, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Hover/focus label for icon-only controls.
 *
 * Rendered through a portal with fixed positioning rather than as an absolutely-positioned
 * child: almost every icon button in this app sits inside a table, and `Table` wraps its rows
 * in `overflow-hidden` + `overflow-x-auto`, which would clip an in-flow tooltip.
 *
 * The listeners live on a wrapper span rather than the control itself so the label still
 * appears for a *disabled* button — those fire no pointer events of their own, and a locked
 * control is precisely the one whose explanation matters most.
 */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = useCallback(() => {
    if (!window.matchMedia('(min-width: 768px)').matches) return;
    const r = ref.current?.getBoundingClientRect();
    // 6px of breathing room above the trigger; the tooltip itself is shifted up by its own
    // height via -translate-y-full, so its height doesn't need measuring.
    if (r) setPos({ top: r.top - 6, left: r.left + r.width / 2 });
  }, []);
  const hide = useCallback(() => setPos(null), []);

  return (
    <>
      <span
        ref={ref}
        className="inline-flex"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocusCapture={show}
        onBlurCapture={hide}
      >
        {children}
      </span>
      {pos !== null &&
        createPortal(
          <span
            role="tooltip"
            style={{ top: pos.top, left: pos.left }}
            className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-fg px-2 py-1 text-xs font-medium text-bg shadow-soft hidden md:block"
          >
            {label}
          </span>,
          document.body,
        )}
    </>
  );
}
