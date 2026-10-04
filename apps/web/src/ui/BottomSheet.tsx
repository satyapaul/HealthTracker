import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export interface BottomSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Sticky footer action area (e.g. a "Confirm Selection" button). */
  footer?: ReactNode;
}

/**
 * Mobile bottom-sheet modal (used by the hospital picker). Closes on Escape or
 * backdrop click, traps initial focus on the panel, and restores focus on close.
 */
export function BottomSheet({ open, title, onClose, children, footer }: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    lastFocused.current = document.activeElement;
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (lastFocused.current instanceof HTMLElement) lastFocused.current.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="bottom-sheet-overlay"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20, 24, 26, 0.4)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 50,
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="bottom-sheet-panel"
        style={{
          width: '100%',
          maxWidth: '480px',
          background: 'var(--color-surface)',
          borderTopLeftRadius: 'var(--radius-lg)',
          borderTopRightRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-sheet)',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          outline: 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
          <span
            aria-hidden
            style={{
              width: '44px',
              height: '5px',
              borderRadius: 'var(--radius-pill)',
              background: 'var(--color-border)',
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 20px',
          }}
        >
          <h2 style={{ fontSize: '22px', fontWeight: 700 }}>{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              borderRadius: 'var(--radius-pill)',
              width: '36px',
              height: '36px',
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              fontSize: '18px',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ padding: '8px 20px 16px', overflowY: 'auto', flex: 1 }}>{children}</div>
        {footer && (
          <div style={{ padding: '12px 20px 20px', borderTop: '1px solid var(--color-border)' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
