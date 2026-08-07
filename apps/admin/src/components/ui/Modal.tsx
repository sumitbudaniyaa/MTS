import { type ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';

const modalWidths = { md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' } as const;

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof modalWidths;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Lock the page behind the dialog. Without this the body keeps its own scroll — and on a
  // phone, where the page is often wider than the viewport, that shows up as the dialog
  // sliding left and right under your thumb while you try to type in it.
  useEffect(() => {
    if (!open) return;
    const { overflow, touchAction } = document.body.style;
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    return () => {
      document.body.style.overflow = overflow;
      document.body.style.touchAction = touchAction;
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overscroll-contain p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        // `max-h-[100dvh]` minus the wrapper padding: on mobile the browser chrome makes vh
        // taller than what you can actually see, so a 90vh dialog runs off the bottom.
        className={`card relative z-10 flex max-h-[calc(100dvh-2rem)] w-full ${modalWidths[size]} flex-col p-5 shadow-lift sm:p-6`}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight text-fg">{title}</h2>
          <button
            onClick={onClose}
            className="-mr-1 rounded-lg p-1.5 text-muted transition hover:bg-surface-2 hover:text-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">{children}</div>
        {footer && <div className="mt-6 flex justify-end gap-2 border-t border-border pt-5">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  loading,
  danger,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  loading?: boolean;
  danger?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">{message}</p>
    </Modal>
  );
}
