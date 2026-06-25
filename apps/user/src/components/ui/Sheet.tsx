import { type ReactNode, useEffect } from 'react';

/** Minimal bottom sheet: dim backdrop + rounded panel sliding up from the bottom. */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <div className="relative z-10 w-full max-w-md rounded-t-2xl border-t border-border bg-surface p-5 pb-7">
        <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-border" />
        {title && <h2 className="mb-4 text-sm font-semibold text-fg">{title}</h2>}
        {children}
      </div>
    </div>
  );
}
