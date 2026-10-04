import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, ArrowLeftIcon, ChatIcon, ChartIcon } from '../../ui';
import { doseApi } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import type { DoctorResponse, DoseChange } from '../../api/types';
import {
  DOSE_FIELDS,
  DRUG_LEVEL_FIELDS,
  ALL_LAB_FIELDS,
} from '../../features/followup/field-catalog';

const LABEL_BY_KEY: Record<string, string> = Object.fromEntries(
  [...DOSE_FIELDS, ...DRUG_LEVEL_FIELDS, ...ALL_LAB_FIELDS].map((f) => [f.key, f.label])
);

/**
 * Clinician Review detail (mock: doctor-response-detail). Shows the doctor's
 * response for a reviewed row: medication adjustments (old -> new, flagged
 * Action Required), additional tests requested, and clinical remarks, with
 * Open Chat / View Full Chart actions. Loads the response + dose-change history.
 */
export function ResponseDetailPage() {
  const { rowId = '' } = useParams();
  const navigate = useNavigate();
  const [response, setResponse] = useState<DoctorResponse | null>(null);
  const [changes, setChanges] = useState<DoseChange[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([doseApi.getResponse(rowId), doseApi.getDoseChanges(rowId)])
      .then(([resp, dc]) => {
        if (!active) return;
        setResponse(resp);
        setChanges(dc.doseChanges);
      })
      .catch((err) => {
        if (active)
          setError(err instanceof ApiError ? err.message : 'Could not load the response.');
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [rowId]);

  const tests = Array.isArray(response?.additionalTests)
    ? (response!.additionalTests as unknown[]).map(testLabel).filter(Boolean)
    : [];

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
        background: 'var(--color-bg)',
      }}
    >
      <div style={{ width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column' }}>
        <header
          style={{
            background: 'var(--color-surface)',
            borderBottom: '1px solid var(--color-border)',
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Back"
            style={{
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: 'var(--color-text)',
            }}
          >
            <ArrowLeftIcon size={24} />
          </button>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 700 }}>Clinician Review</h1>
            {response && (
              <p style={{ color: 'var(--color-text-muted)', fontSize: '14px' }}>
                {formatDateTime(response.sentAt)}
              </p>
            )}
          </div>
        </header>

        <main
          style={{
            flex: 1,
            padding: '20px 20px 110px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
          }}
        >
          {loading && <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>}
          {error && !loading && (
            <Card>
              <p style={{ color: 'var(--color-text-muted)' }}>{error}</p>
            </Card>
          )}

          {response && !loading && (
            <>
              {/* Medication adjustments */}
              <Section title="Medication Adjustments">
                {changes.length === 0 ? (
                  <Card>
                    <p style={{ color: 'var(--color-text-muted)' }}>
                      No dose changes — continue your current regimen.
                    </p>
                  </Card>
                ) : (
                  changes.map((c) => <DoseChangeCard key={c.id} change={c} />)
                )}
              </Section>

              {/* Additional tests */}
              {tests.length > 0 && (
                <Section title="Additional Tests Requested">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {tests.map((t, i) => (
                      <label
                        key={`${t}-${i}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          background: 'var(--color-surface)',
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-md)',
                          padding: '14px 16px',
                          fontWeight: 600,
                        }}
                      >
                        <input type="checkbox" aria-label={t} /> {t}
                      </label>
                    ))}
                  </div>
                </Section>
              )}

              {/* Clinical remarks */}
              {response.clinicalNotes && (
                <Section title="Clinical Remarks">
                  <Card>
                    <p style={{ lineHeight: 1.6 }}>{response.clinicalNotes}</p>
                  </Card>
                </Section>
              )}

              {response.nextFollowupIntervalDays != null && (
                <p style={{ color: 'var(--color-text-muted)' }}>
                  Next follow-up in <strong>{response.nextFollowupIntervalDays} days</strong>.
                </p>
              )}
            </>
          )}
        </main>

        <footer
          style={{
            position: 'sticky',
            bottom: 0,
            display: 'flex',
            gap: '12px',
            padding: '16px 20px',
            paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
            background: 'var(--color-surface)',
            borderTop: '1px solid var(--color-border)',
          }}
        >
          <Button
            variant="secondary"
            size="lg"
            style={{ flex: 1 }}
            leading={<ChatIcon size={20} />}
            onClick={() => navigate('/app/chat')}
          >
            Open Chat
          </Button>
          <Button
            size="lg"
            style={{ flex: 1 }}
            leading={<ChartIcon size={20} />}
            onClick={() => navigate('/app/chart')}
          >
            View Full Chart
          </Button>
        </footer>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <h2
        style={{
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--color-text-muted)',
          fontSize: '13px',
          fontWeight: 700,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function DoseChangeCard({ change }: { change: DoseChange }) {
  const label = LABEL_BY_KEY[change.fieldName] ?? change.fieldName;
  return (
    <div
      style={{
        background: 'var(--color-danger-surface)',
        border: '1px solid var(--color-danger)',
        borderRadius: 'var(--radius-md)',
        padding: '16px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        <strong style={{ color: 'var(--color-danger)' }}>{label} dose changed</strong>
        <span
          style={{
            background: 'var(--color-primary)',
            color: 'var(--color-on-primary)',
            borderRadius: 'var(--radius-pill)',
            padding: '4px 12px',
            fontSize: '12px',
            fontWeight: 700,
          }}
        >
          Action Required
        </span>
      </div>
      <p style={{ marginTop: '8px', fontSize: '18px', fontWeight: 700 }}>
        <span style={{ color: 'var(--color-text-muted)' }}>{change.oldValue ?? '—'}</span>
        {'  →  '}
        <span style={{ color: 'var(--color-danger)' }}>{change.newValue ?? '—'}</span>
      </p>
      {change.reason && (
        <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', marginTop: '4px' }}>
          {change.reason}
        </p>
      )}
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** additionalTests entries may be plain strings or { name } objects. */
function testLabel(t: unknown): string {
  if (typeof t === 'string') return t;
  if (
    t &&
    typeof t === 'object' &&
    'name' in t &&
    typeof (t as { name: unknown }).name === 'string'
  ) {
    return (t as { name: string }).name;
  }
  return '';
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
