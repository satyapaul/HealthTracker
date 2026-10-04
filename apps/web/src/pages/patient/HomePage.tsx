import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Pill, PillIcon, CheckCircleIcon, PlusIcon } from '../../ui';
import { useSession } from '../../auth/useSession';
import { patientApi } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import type { FollowUpRow } from '../../api/types';

interface Stat {
  label: string;
  value: string;
  unit?: string;
}

/**
 * Patient home dashboard (mock: patient-home-dashboard). Greeting, next
 * follow-up CTA, last lab stats, and recent updates. Values derive from the
 * patient's most recent follow-up row; the screen degrades gracefully while
 * loading, on error, and when there is no data yet.
 */
export function HomePage() {
  const session = useSession();
  const navigate = useNavigate();
  const [rows, setRows] = useState<FollowUpRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    patientApi
      .listRows()
      .then((r) => {
        if (active) setRows(r.rows);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : 'Could not load your data.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const latest = useMemo(() => mostRecent(rows ?? []), [rows]);
  const stats = useMemo(() => deriveStats(latest), [latest]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <GreetingHeader />

      {/* Next follow-up due */}
      <Card accent padding={5}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p
              style={{
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--color-text-muted)',
                fontSize: '13px',
                fontWeight: 700,
              }}
            >
              Next Follow-up Due
            </p>
            <p style={{ fontSize: '26px', fontWeight: 700, marginTop: '6px' }}>
              {nextFollowUpLabel(latest)}
            </p>
          </div>
          <Pill tone="primary">Upcoming</Pill>
        </div>
        <Button
          size="lg"
          block
          leading={<PlusIcon size={20} />}
          style={{ marginTop: '18px' }}
          onClick={() => navigate('/app/submit')}
        >
          Submit Now
        </Button>
      </Card>

      {/* Last lab stats */}
      <section>
        <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '12px' }}>
          Your Last Lab Stats
        </h2>
        {loading ? (
          <SkeletonStats />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            {stats.map((s) => (
              <Card key={s.label} padding={4}>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '14px' }}>{s.label}</p>
                <p style={{ marginTop: '8px', fontSize: '22px', fontWeight: 700 }}>
                  <span style={{ color: 'var(--color-primary)' }}>{s.value}</span>{' '}
                  {s.unit && (
                    <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
                      {s.unit}
                    </span>
                  )}
                </p>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Recent updates */}
      <section>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: '12px',
          }}
        >
          <h2 style={{ fontSize: '22px', fontWeight: 700 }}>Recent Updates</h2>
          <button
            type="button"
            onClick={() => navigate('/app/chart')}
            style={{
              border: 'none',
              background: 'none',
              color: 'var(--color-primary)',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '15px',
            }}
          >
            See All
          </button>
        </div>
        {error ? (
          <Card>
            <p style={{ color: 'var(--color-text-muted)' }}>{error}</p>
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <UpdatesList rows={rows ?? []} loading={loading} />
          </div>
        )}
      </section>

      {!session && (
        <p style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>
          Showing a preview — sign in to see your own data.
        </p>
      )}
    </div>
  );
}

function GreetingHeader() {
  const greeting = timeGreeting();
  return (
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '18px' }}>{greeting},</p>
        <h1 style={{ fontSize: '32px', fontWeight: 700 }}>Welcome</h1>
      </div>
      <div
        aria-hidden
        style={{
          width: '56px',
          height: '56px',
          borderRadius: 'var(--radius-pill)',
          background: 'var(--color-surface-accent)',
          border: '2px solid var(--color-primary)',
        }}
      />
    </header>
  );
}

function UpdatesList({ rows, loading }: { rows: FollowUpRow[]; loading: boolean }) {
  if (loading) {
    return (
      <>
        <SkeletonRow />
        <SkeletonRow />
      </>
    );
  }
  const reviewed = rows.filter((r) => r.status === 'reviewed').slice(0, 3);
  if (reviewed.length === 0) {
    return (
      <Card>
        <p style={{ color: 'var(--color-text-muted)' }}>
          No updates yet. Submit a follow-up to get your care team’s review.
        </p>
      </Card>
    );
  }
  return (
    <>
      {reviewed.map((r) => (
        <Card key={r.id} padding={4}>
          <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
            <IconBadge>
              {r.doctorPrescribedDoses ? <PillIcon size={22} /> : <CheckCircleIcon size={22} />}
            </IconBadge>
            <div>
              <p style={{ fontWeight: 700 }}>
                {r.doctorPrescribedDoses ? 'Dose adjustment' : 'Lab submission reviewed'}
              </p>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', marginTop: '2px' }}>
                {formatDate(r.reviewedAt ?? r.submittedAt ?? r.ppDate)}
                {r.engagementHospitalName ? ` • ${r.engagementHospitalName}` : ''}
              </p>
            </div>
          </div>
        </Card>
      ))}
    </>
  );
}

function IconBadge({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '44px',
        height: '44px',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-surface-accent)',
        color: 'var(--color-primary)',
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
}

function SkeletonStats() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{ height: '84px', borderRadius: 'var(--radius-lg)', background: '#ecece6' }}
        />
      ))}
    </div>
  );
}

function SkeletonRow() {
  return (
    <div style={{ height: '76px', borderRadius: 'var(--radius-lg)', background: '#ecece6' }} />
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

function timeGreeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function mostRecent(rows: FollowUpRow[]): FollowUpRow | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => (a.ppDate < b.ppDate ? 1 : -1))[0];
}

function deriveStats(row: FollowUpRow | null): Stat[] {
  const num = (v: unknown): string => (v === null || v === undefined ? '—' : String(v));
  const tac = row?.drugLevels?.tac_level ?? row?.drugLevels?.['tac_level'];
  const hba1c = row?.labValues?.hba1c ?? row?.labValues?.['hba1c'];
  return [
    { label: 'Tac Level', value: num(tac), unit: tac != null ? 'ng/mL' : undefined },
    { label: 'HbA1c', value: hba1c != null ? `${hba1c}%` : '—' },
    {
      label: 'Weight',
      value: row?.weightKg != null ? String(row.weightKg) : '—',
      unit: row?.weightKg != null ? 'kg' : undefined,
    },
  ];
}

function nextFollowUpLabel(latest: FollowUpRow | null): string {
  if (!latest) return 'Not scheduled';
  // Without a scheduler feed yet, show the latest recorded follow-up date.
  return formatDate(latest.ppDate);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
