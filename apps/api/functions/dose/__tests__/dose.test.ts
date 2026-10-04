/**
 * WP 2.3 doctor-review Lambda unit tests. All dependencies are injected fakes —
 * no real AWS / DB. Covers the DoD (dose changes visibly distinct + audit rows)
 * plus the must-test invariants (unassigned/cross-patient doctor denied; review
 * only a pending row; one response per row; patient can read response + dose
 * history; dose_changes append-only / prescribed distinct from reported).
 */
import { describe, it, expect } from 'vitest';
import { route } from '../router';
import type { DoseRequest, Principal } from '../http';
import { makeBundle } from './fakes';

function req(partial: Partial<DoseRequest> & Pick<DoseRequest, 'method' | 'path'>): DoseRequest {
  return { headers: {}, body: null, principal: null, pathParams: {}, ...partial };
}

function parse(body: string): {
  success: boolean;
  data: Record<string, unknown> | null;
  error: { code: string } | null;
} {
  return JSON.parse(body);
}

const doctor = (id: string): Principal => ({ userId: id, role: 'doctor', patientId: '' });
const patient = (patientId: string): Principal => ({
  userId: `user-${patientId}`,
  role: 'patient',
  patientId,
});

const ROW = 'row-1';

/** Seed a pending row for patient p1 with patient-reported doses + assign d1. */
function seedPendingRow(b: ReturnType<typeof makeBundle>): void {
  b.db.seedRow({
    id: ROW,
    patientId: 'p1',
    status: 'pending',
    patientReportedDoses: { neoral_tac: '2/2', pred: '5' },
  });
  b.db.assign('d1', 'p1');
}

describe('PUT /followup/rows/{id}/response (doctor review)', () => {
  it('records dose changes, writes the response, and marks the row reviewed', async () => {
    const b = makeBundle(new Date('2026-06-10T10:00:00.000Z'));
    seedPendingRow(b);

    const res = await route(
      b.deps,
      req({
        method: 'PUT',
        path: `/followup/rows/${ROW}/response`,
        principal: doctor('d1'),
        body: JSON.stringify({
          // Doctor prescribes: neoral_tac changed 2/2 -> 3/2, pred unchanged (5),
          // aza_mpa newly prescribed.
          doctorPrescribedDoses: { neoral_tac: '3/2', pred: '5', aza_mpa: '1/1' },
          clinicalNotes: 'Increase tac',
          nextFollowupIntervalDays: 14,
          additionalTests: [{ code: 'TAC_LEVEL', description: 'Repeat in 7 days' }],
        }),
      })
    );

    expect(res.statusCode).toBe(200);
    const data = parse(res.body).data as Record<string, unknown>;
    expect(data.status).toBe('reviewed');
    expect(data.responseId).toBe('id-3'); // 2 dose-change ids, then the response
    // Two dose changes recorded (neoral_tac changed, aza_mpa newly set); pred
    // unchanged so NOT recorded.
    const changes = data.doseChanges as {
      fieldName: string;
      oldValue: string | null;
      newValue: string;
    }[];
    expect(changes).toHaveLength(2);
    const byField = Object.fromEntries(changes.map((c) => [c.fieldName, c]));
    expect(byField.neoral_tac).toMatchObject({ oldValue: '2/2', newValue: '3/2' });
    expect(byField.aza_mpa).toMatchObject({ oldValue: null, newValue: '1/1' });
    expect(byField.pred).toBeUndefined();
    // Audit rows carry the acting doctor + timestamp.
    expect(b.db.doseChanges.every((c) => c.changedBy === 'd1')).toBe(true);
    expect(b.db.doseChanges.every((c) => c.changedAt === '2026-06-10T10:00:00.000Z')).toBe(true);
    // Prescribed doses are stored in a SEPARATE field from the patient-reported
    // doses (visually distinct — DoD).
    const row = b.db.rows.get(ROW)!;
    expect(row.patientReportedDoses).toEqual({ neoral_tac: '2/2', pred: '5' });
    expect(row.doctorPrescribedDoses).toEqual({ neoral_tac: '3/2', pred: '5', aza_mpa: '1/1' });
    // WP 5.2: a DoseChanged system card is posted with the changed fields.
    expect(b.systemCards.cards).toHaveLength(1);
    const card = b.systemCards.cards[0];
    expect(card.patientId).toBe('p1');
    expect(card.changes.map((c) => c.fieldName).sort()).toEqual(['aza_mpa', 'neoral_tac']);
  });

  it('does NOT post a system card when no doses changed', async () => {
    const b = makeBundle();
    seedPendingRow(b);
    await route(
      b.deps,
      req({
        method: 'PUT',
        path: `/followup/rows/${ROW}/response`,
        principal: doctor('d1'),
        // Prescribe exactly the patient-reported doses -> zero changes.
        body: JSON.stringify({
          doctorPrescribedDoses: { neoral_tac: '2/2', pred: '5' },
          additionalTests: [],
        }),
      })
    );
    expect(b.systemCards.cards).toHaveLength(0);
  });

  it('DENIES a doctor not assigned to the patient (404, no leak)', async () => {
    const b = makeBundle();
    seedPendingRow(b); // assigned to d1
    const res = await route(
      b.deps,
      req({
        method: 'PUT',
        path: `/followup/rows/${ROW}/response`,
        principal: doctor('d2'), // not assigned
        body: JSON.stringify({ doctorPrescribedDoses: { pred: '10' }, additionalTests: [] }),
      })
    );
    expect(res.statusCode).toBe(404);
    expect(b.db.responses.size).toBe(0);
    expect(b.db.doseChanges).toHaveLength(0);
  });

  it('rejects reviewing a non-pending (draft) row', async () => {
    const b = makeBundle();
    b.db.seedRow({ id: ROW, patientId: 'p1', status: 'draft', patientReportedDoses: {} });
    b.db.assign('d1', 'p1');
    const res = await route(
      b.deps,
      req({
        method: 'PUT',
        path: `/followup/rows/${ROW}/response`,
        principal: doctor('d1'),
        body: JSON.stringify({ doctorPrescribedDoses: { pred: '5' }, additionalTests: [] }),
      })
    );
    expect(res.statusCode).toBe(409);
    expect(parse(res.body).error?.code).toBe('CONFLICT');
  });

  it('rejects a second review of the same row (one response per row)', async () => {
    const b = makeBundle();
    seedPendingRow(b);
    const body = JSON.stringify({ doctorPrescribedDoses: { pred: '6' }, additionalTests: [] });
    await route(
      b.deps,
      req({ method: 'PUT', path: `/followup/rows/${ROW}/response`, principal: doctor('d1'), body })
    );
    // Row is now reviewed; a second attempt is a non-pending conflict.
    const res = await route(
      b.deps,
      req({ method: 'PUT', path: `/followup/rows/${ROW}/response`, principal: doctor('d1'), body })
    );
    expect(res.statusCode).toBe(409);
  });

  it('forbids a patient from submitting a review', async () => {
    const b = makeBundle();
    seedPendingRow(b);
    const res = await route(
      b.deps,
      req({
        method: 'PUT',
        path: `/followup/rows/${ROW}/response`,
        principal: patient('p1'),
        body: JSON.stringify({ doctorPrescribedDoses: { pred: '5' }, additionalTests: [] }),
      })
    );
    expect(res.statusCode).toBe(403);
    expect(parse(res.body).error?.code).toBe('FORBIDDEN');
  });

  it('rejects an unknown dose field key', async () => {
    const b = makeBundle();
    seedPendingRow(b);
    const res = await route(
      b.deps,
      req({
        method: 'PUT',
        path: `/followup/rows/${ROW}/response`,
        principal: doctor('d1'),
        body: JSON.stringify({ doctorPrescribedDoses: { wysolone: '5' }, additionalTests: [] }),
      })
    );
    expect(res.statusCode).toBe(400);
    expect(parse(res.body).error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects unauthenticated requests', async () => {
    const b = makeBundle();
    seedPendingRow(b);
    const res = await route(
      b.deps,
      req({
        method: 'PUT',
        path: `/followup/rows/${ROW}/response`,
        body: JSON.stringify({ doctorPrescribedDoses: {}, additionalTests: [] }),
      })
    );
    expect(res.statusCode).toBe(401);
  });
});

describe('GET dose history + response (RLS)', () => {
  async function reviewOnce(b: ReturnType<typeof makeBundle>): Promise<void> {
    await route(
      b.deps,
      req({
        method: 'PUT',
        path: `/followup/rows/${ROW}/response`,
        principal: doctor('d1'),
        body: JSON.stringify({
          doctorPrescribedDoses: { neoral_tac: '3/2' },
          clinicalNotes: 'ok',
          additionalTests: [],
        }),
      })
    );
  }

  it('the patient can read the dose-change history for their own row', async () => {
    const b = makeBundle();
    seedPendingRow(b);
    await reviewOnce(b);
    const res = await route(
      b.deps,
      req({ method: 'GET', path: `/followup/rows/${ROW}/dose-changes`, principal: patient('p1') })
    );
    expect(res.statusCode).toBe(200);
    const changes = (parse(res.body).data as { doseChanges: unknown[] }).doseChanges;
    expect(changes).toHaveLength(1);
  });

  it('another patient cannot read the dose history (empty)', async () => {
    const b = makeBundle();
    seedPendingRow(b);
    await reviewOnce(b);
    const res = await route(
      b.deps,
      req({ method: 'GET', path: `/followup/rows/${ROW}/dose-changes`, principal: patient('p2') })
    );
    expect(res.statusCode).toBe(200);
    const changes = (parse(res.body).data as { doseChanges: unknown[] }).doseChanges;
    expect(changes).toHaveLength(0);
  });

  it('the patient can read the doctor response; a stranger gets 404', async () => {
    const b = makeBundle();
    seedPendingRow(b);
    await reviewOnce(b);

    const own = await route(
      b.deps,
      req({ method: 'GET', path: `/followup/rows/${ROW}/response`, principal: patient('p1') })
    );
    expect(own.statusCode).toBe(200);
    expect((parse(own.body).data as Record<string, unknown>).followUpRowId).toBe(ROW);

    const stranger = await route(
      b.deps,
      req({ method: 'GET', path: `/followup/rows/${ROW}/response`, principal: patient('p2') })
    );
    expect(stranger.statusCode).toBe(404);
  });

  it('404 when no response exists yet', async () => {
    const b = makeBundle();
    seedPendingRow(b);
    const res = await route(
      b.deps,
      req({ method: 'GET', path: `/followup/rows/${ROW}/response`, principal: patient('p1') })
    );
    expect(res.statusCode).toBe(404);
  });
});

describe('routing', () => {
  it('unknown route returns 404', async () => {
    const b = makeBundle();
    const res = await route(b.deps, req({ method: 'GET', path: '/nope', principal: doctor('d1') }));
    expect(res.statusCode).toBe(404);
  });
});
