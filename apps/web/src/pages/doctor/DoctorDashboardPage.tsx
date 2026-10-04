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
 * The flow chart is fed by GET /followup/patients/{id}/rows (RLS: an assigned
 * doctor sees only their patients' rows). When a selected patient has no rows,
 * a graceful empty state + the legend are shown.
 */
export function DoctorDashboardPage() {
  const [entries, setEntries] = useState<DoctorPatientEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rows, setRows] = useState<FollowUpRow[] | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [rowsLoading, setRowsLoading] = useState(false);

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

  // Load the selected patient's chart rows.
  useEffect(() => {
    if (!selectedId) {
      setRows(null);
      return;
    }
    let active = true;
    setRowsLoading(true);
    setRowsError(null);
    doctorApi
      .getPatientRows(selectedId)
      .then((r) => active && setRows(r.rows))
      .catch((err) => {
        if (active)
          setRowsError(err instanceof ApiError ? err.message : 'Could not load the chart.');
      })
      .finally(() => active && setRowsLoading(false));
    return () => {
      active = false;
    };
  }, [selectedId]);

  const selected = useMemo(
    () => (entries ?? []).find((e) => e.patient.id === selectedId) ?? null,
    [entries, selectedId]
  );

  const chartRows: FollowUpRow[] = rows ?? [];

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

      <div className="doctor-dashboard-grid">
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

          {rowsLoading && <p style={{ color: 'var(--color-text-muted)' }}>Loading chart…</p>}
          {rowsError && !rowsLoading && (
            <Card>
              <p style={{ color: 'var(--color-text-muted)' }}>{rowsError}</p>
            </Card>
          )}
          {!rowsLoading && !rowsError && chartRows.length === 0 && (
            <Card>
              <p style={{ fontWeight: 600 }}>No submissions yet</p>
              <p style={{ color: 'var(--color-text-muted)', marginTop: '6px' }}>
                This patient has not submitted any follow-up rows. Once they do, their dated results
                appear here with range coding.
              </p>
              <div style={{ marginTop: '16px' }}>
                <FlowChartLegend />
              </div>
            </Card>
          )}
          {!rowsLoading && !rowsError && chartRows.length > 0 && (
            <>
              <FlowChartTable rows={chartRows} />
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
