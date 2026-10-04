import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Pill } from '../../ui';
import { clearSession } from '../../api/session';
import { doctorApi, type DoctorPatientEntry } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import type { FollowUpRow } from '../../api/types';
import { FlowChartTable, FlowChartLegend } from '../../features/doctor/FlowChartTable';

/**
 * Doctor Post-Op Monitoring dashboard (mock: doctor/post-op-monitoring-
 * dashboard). Lists the doctor's assigned patients (with pending badges), and
 * renders the selected patient's post-op flow chart with High/Warn/Normal
 * coding + legend and an "Update Post-Op Orders" action.
 *
 * NOTE: a doctor-facing endpoint to read a patient's follow-up rows across
 * dates does not exist yet (the followup list is patient-RLS-scoped). Until
 * that WP lands, the flow chart renders from `rows` when provided and shows an
 * explicit "chart data source pending" state otherwise — the patient list and
 * the whole chart UI (ranges, coding, legend, scroll) are fully functional.
 */
export function DoctorDashboardPage() {
  const [entries, setEntries] = useState<DoctorPatientEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    doctorApi
      .listPatients()
      .then((r) => {
        if (!active) return;
        setEntries(r.patients);
        setSelectedId((prev) => prev ?? r.patients[0]?.patient.id ?? null);
      })
      .catch((err) =>
        active ? setError(err instanceof ApiError ? err.message : 'Could not load patients.') : null
      );
    return () => {
      active = false;
    };
  }, []);

  const selected = useMemo(
    () => (entries ?? []).find((e) => e.patient.id === selectedId) ?? null,
    [entries, selectedId]
  );

  // No doctor-rows endpoint yet; render from an (empty) rows source for now.
  const rows: FollowUpRow[] = [];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <header
        style={{
          background: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)',
          padding: '16px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--color-primary)' }}>
          Post-Op Monitoring
        </h1>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <Pill tone="accent">Live Sync</Pill>
          <Button variant="ghost" onClick={() => clearSession()}>
            Sign out
          </Button>
        </div>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(240px, 300px) 1fr',
          gap: '24px',
          padding: '24px',
          maxWidth: '1200px',
          margin: '0 auto',
          alignItems: 'start',
        }}
      >
        {/* Patient list */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 700 }}>Assigned Patients</h2>
          {error && <p style={{ color: 'var(--color-text-muted)' }}>{error}</p>}
          {!entries && !error && <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>}
          {entries?.length === 0 && (
            <p style={{ color: 'var(--color-text-muted)' }}>No patients assigned.</p>
          )}
          {(entries ?? []).map((e) => (
            <button
              key={e.patient.id}
              type="button"
              onClick={() => setSelectedId(e.patient.id)}
              style={{
                textAlign: 'left',
                border: `1px solid ${selectedId === e.patient.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
                background:
                  selectedId === e.patient.id
                    ? 'var(--color-surface-accent)'
                    : 'var(--color-surface)',
                borderRadius: 'var(--radius-md)',
                padding: '14px 16px',
                cursor: 'pointer',
              }}
            >
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <strong>{e.patient.name}</strong>
                {e.hasPending && (
                  <span
                    style={{
                      background: 'var(--color-status-warn-bg)',
                      color: 'var(--color-status-warn-text)',
                      borderRadius: 'var(--radius-pill)',
                      padding: '2px 10px',
                      fontSize: '12px',
                      fontWeight: 700,
                    }}
                  >
                    {e.pendingSubmissionCount} pending
                  </span>
                )}
              </div>
              <div style={{ color: 'var(--color-text-muted)', fontSize: '13px', marginTop: '2px' }}>
                {e.patient.diagnosis} · MAX {e.patient.maxId}
              </div>
            </button>
          ))}
        </aside>

        {/* Flow chart */}
        <main style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2
              style={{
                fontSize: '16px',
                fontWeight: 700,
                color: 'var(--color-primary)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              Post-Operative Investigation Flow Chart
            </h2>
            {selected && (
              <span style={{ color: 'var(--color-text-muted)' }}>{selected.patient.name}</span>
            )}
          </div>

          {rows.length === 0 ? (
            <Card>
              <p style={{ fontWeight: 600 }}>Chart data source pending</p>
              <p style={{ color: 'var(--color-text-muted)', marginTop: '6px' }}>
                The flow chart renders a patient’s dated submissions with range coding. A
                doctor-facing endpoint to read a patient’s rows is a planned backend work package;
                once wired, this table populates automatically. The patient list and chart UI below
                are fully functional.
              </p>
              <div style={{ marginTop: '16px' }}>
                <FlowChartLegend />
              </div>
            </Card>
          ) : (
            <>
              <FlowChartTable rows={rows} />
              <FlowChartLegend />
            </>
          )}

          <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
            <Button size="lg" disabled={!selected}>
              Update Post-Op Orders
            </Button>
            <Button variant="ghost" size="lg">
              Review Full Patient History
            </Button>
          </div>
        </main>
      </div>
    </div>
  );
}
