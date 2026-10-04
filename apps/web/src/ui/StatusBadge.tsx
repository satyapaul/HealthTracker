import type { ReactNode } from 'react';

/** Clinical range status, matching the doctor flow-chart legend in the mocks. */
export type ClinicalStatus = 'high' | 'warn' | 'normal';

const palette: Record<ClinicalStatus, { bg: string; text: string; label: string }> = {
  high: { bg: 'var(--color-status-high-bg)', text: 'var(--color-status-high-text)', label: 'High' },
  warn: { bg: 'var(--color-status-warn-bg)', text: 'var(--color-status-warn-text)', label: 'Warn' },
  normal: {
    bg: 'var(--color-status-normal-bg)',
    text: 'var(--color-status-normal-text)',
    label: 'Normal',
  },
};

export interface StatusBadgeProps {
  status: ClinicalStatus;
  children?: ReactNode;
}

export function StatusBadge({ status, children }: StatusBadgeProps) {
  const p = palette[status];
  return (
    <span
      style={{
        display: 'inline-block',
        background: p.bg,
        color: p.text,
        fontWeight: 700,
        fontSize: '13px',
        padding: '3px 10px',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      {children ?? p.label}
    </span>
  );
}

/** Neutral/accent pill used for small labels like "In 7 Days" or a hospital code. */
export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'primary' | 'accent';
}) {
  const tones: Record<string, React.CSSProperties> = {
    neutral: { background: 'var(--color-surface)', color: 'var(--color-text)' },
    primary: { background: 'var(--color-primary)', color: 'var(--color-on-primary)' },
    accent: { background: 'var(--color-surface-accent)', color: 'var(--color-primary)' },
  };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        borderRadius: 'var(--radius-pill)',
        fontWeight: 700,
        fontSize: '13px',
        ...tones[tone],
      }}
    >
      {children}
    </span>
  );
}
