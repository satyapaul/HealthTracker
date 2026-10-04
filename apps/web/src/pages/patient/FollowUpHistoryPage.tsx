import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, GlobeIcon, HospitalIcon, PlusIcon } from '../../ui';
import { patientApi } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import type { FollowUpRow } from '../../api/types';
import { StatusPill } from '../../features/followup/StatusPill';

/**
 * Follow-Up History (Chart tab, mock: Follow-Up History). Lists the patient's
 * rows newest-first, with filter chips (All + each engagement hospital), a
 * status pill per row, a compact lab/dose summary, a "View Response" link for
 * reviewed rows, and a "New Follow-Up" FAB into the wizard.
 */
export function FollowUpHistoryPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<FollowUpRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    let active = true;
    patientApi
      .listRows()
      .then((r) => active && setRows(r.rows))
      .catch((err) =>
        active ? setError(err instanceof ApiError ? err.message : 'Could not load history.') : null
      );
    return () => {
      active = false;
    };
  }, []);

  const sorted = useMemo(
    () => [...(rows ?? [])].sort((a, b) => (a.ppDate < b.ppDate ? 1 : -1)),
    [rows]
  );

  // Distinct engagement hospitals for the filter chips.
  const hospitals = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of sorted) {
      if (r.engagementHospitalId) {
        seen.set(r.engagementHospitalId, r.engagementHospitalName ?? r.engagementHospitalId);
      }
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [sorted]);

  const visible =
    filter === 'all' ? sorted : sorted.filter((r) => r.engagementHospitalId === filter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '16px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: 700 }}>Follow-Up History</h1>
          <p style={{ color: 'var(--color-text-muted)' }}>Your dated post-op submissions</p>
        </div>
        {/* Desktop: a header action instead of a floating FAB over empty space. */}
        <span className="desktop-only">
          <Button leading={<PlusIcon size={18} />} onClick={() => navigate('/app/submit')}>
            New Follow-Up
          </Button>
        </span>
      </header>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
          All
        </FilterChip>
        {hospitals.map((h) => (
          <FilterChip key={h.id} active={filter === h.id} onClick={() => setFilter(h.id)}>
            {h.name}
          </FilterChip>
        ))}
      </div>

      {error && (
        <Card>
          <p style={{ color: 'var(--color-text-muted)' }}>{error}</p>
        </Card>
      )}

      {rows && visible.length === 0 && !error && (
        <Card>
          <p style={{ color: 'var(--color-text-muted)' }}>
            No follow-ups yet. Tap “New Follow-Up” to submit your first one.
          </p>
        </Card>
      )}

      {!rows && !error && <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>}

      <div className="grid-cols-desktop-2" style={{ gap: '12px' }}>
        {visible.map((r) => (
          <RowCard
            key={r.id}
            row={r}
            onViewResponse={() => navigate(`/app/rows/${r.id}/response`)}
          />
        ))}
      </div>

      {/* New Follow-Up FAB — mobile only (desktop has the header action). */}
      <button
        type="button"
        className="mobile-only"
        onClick={() => navigate('/app/submit')}
        style={{
          position: 'fixed',
          right: '20px',
          bottom: '92px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '14px 20px',
          borderRadius: 'var(--radius-pill)',
          border: 'none',
          background: 'var(--color-primary)',
          color: 'var(--color-on-primary)',
          fontWeight: 700,
          boxShadow: '0 6px 16px rgba(20,24,26,0.2)',
          cursor: 'pointer',
        }}
      >
        <PlusIcon size={20} /> New Follow-Up
      </button>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        padding: '8px 16px',
        borderRadius: 'var(--radius-pill)',
        border: '1px solid transparent',
        cursor: 'pointer',
        fontWeight: 700,
        fontSize: '14px',
        background: active ? 'var(--color-primary)' : 'var(--color-surface-accent)',
        color: active ? 'var(--color-on-primary)' : 'var(--color-primary)',
      }}
    >
      {children}
    </button>
  );
}

function RowCard({ row, onViewResponse }: { row: FollowUpRow; onViewResponse: () => void }) {
  const isVirtualName = (row.engagementHospitalName ?? '').toLowerCase().includes('virtual');
  const summary = labSummary(row);
  const doseSummary = doseLine(row);

  return (
    <Card padding={4}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <strong style={{ fontSize: '18px' }}>{formatDate(row.ppDate)}</strong>
          <span
            style={{
              color: 'var(--color-text-muted)',
              display: 'inline-flex',
              gap: '4px',
              alignItems: 'center',
            }}
          >
            {isVirtualName ? <GlobeIcon size={16} /> : <HospitalIcon size={16} />}
            {row.engagementHospitalName ?? '—'}
          </span>
        </div>
        <StatusPill status={row.status} />
      </div>

      {summary.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '8px',
            marginTop: '12px',
          }}
        >
          {summary.map((s) => (
            <div
              key={s.label}
              style={{
                background: 'var(--color-bg)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 12px',
                fontSize: '14px',
              }}
            >
              <span style={{ color: 'var(--color-text-muted)' }}>{s.label}: </span>
              <strong>{s.value}</strong>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '12px',
          borderTop: '1px solid var(--color-border)',
          paddingTop: '12px',
        }}
      >
        <span style={{ color: 'var(--color-text-muted)', fontSize: '14px' }}>{doseSummary}</span>
        {row.status === 'reviewed' && (
          <button
            type="button"
            onClick={onViewResponse}
            style={{
              border: 'none',
              background: 'none',
              color: 'var(--color-primary)',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            View Response
          </button>
        )}
      </div>
    </Card>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

function labSummary(row: FollowUpRow): { label: string; value: string }[] {
  const l = row.labValues ?? {};
  const pick = (key: string, label: string) =>
    l[key] !== undefined && l[key] !== null ? { label, value: String(l[key]) } : null;
  return [
    pick('hb', 'Hb'),
    pick('plt', 'PLT'),
    pick('bilirubin_total', 'Bili'),
    pick('sgot', 'SGOT'),
  ].filter((x): x is { label: string; value: string } => x !== null);
}

function doseLine(row: FollowUpRow): string {
  const d = row.patientReportedDoses ?? {};
  const parts: string[] = [];
  if (d.neoral_tac) parts.push(`Tac: ${d.neoral_tac}`);
  if (d.pred) parts.push(`Pred: ${d.pred}mg`);
  return parts.join('   ') || 'No doses recorded';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
