import type { FollowUpStatus } from '../../api/types';

/** Follow-up row status pill (mock: Reviewed ✓ / Pending). */
export function StatusPill({ status }: { status: FollowUpStatus }) {
  const map: Record<FollowUpStatus, { label: string; bg: string; fg: string }> = {
    draft: { label: 'Draft', bg: 'var(--color-surface-accent)', fg: 'var(--color-text-muted)' },
    pending: {
      label: 'Pending',
      bg: 'var(--color-status-warn-bg)',
      fg: 'var(--color-status-warn-text)',
    },
    reviewed: {
      label: 'Reviewed ✓',
      bg: 'var(--color-status-normal-bg)',
      fg: 'var(--color-status-normal-text)',
    },
  };
  const s = map[status];
  return (
    <span
      style={{
        display: 'inline-block',
        background: s.bg,
        color: s.fg,
        fontWeight: 700,
        fontSize: '13px',
        padding: '5px 12px',
        borderRadius: 'var(--radius-pill)',
      }}
    >
      {s.label}
    </span>
  );
}
