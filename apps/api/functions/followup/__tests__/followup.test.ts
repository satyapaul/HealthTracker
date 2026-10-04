/**
 * WP 2.2 follow-up row Lambda unit tests. All dependencies are injected fakes —
 * no real AWS / DB. Covers the DoD (all §7.2.1 fields persist; partial entry
 * allowed) plus the must-test invariants (submission rejected without
 * engagement_hospital_id; cross-patient access denied; draft-only edit; submit
 * transitions draft->pending; duplicate (patient,pp_date) rejected).
 */
import { describe, it, expect } from 'vitest';
import { route } from '../router';
import type { FollowupRequest, Principal } from '../http';
import { makeBundle } from './fakes';

function req(
  partial: Partial<FollowupRequest> & Pick<FollowupRequest, 'method' | 'path'>
): FollowupRequest {
  return { headers: {}, body: null, principal: null, pathParams: {}, query: {}, ...partial };
}

function parse(body: string): {
  success: boolean;
  data: Record<string, unknown> | null;
  error: { code: string; details?: Record<string, unknown> } | null;
} {
  return JSON.parse(body);
}

function patient(patientId: string): Principal {
  return { userId: `user-${patientId}`, role: 'patient', patientId };
}
const doctor: Principal = { userId: 'doctor-1', role: 'doctor', patientId: '' };

/** A full §7.2.1 payload exercising all three JSONB groups + weight + comments. */
function fullRowBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ppDate: '2026-06-01',
    engagementHospitalId: 'hosp-1',
    labValues: {
      hb: 10.2,
      tlc: 5.4,
      plt: 180,
      afp: 2.1,
      inr: 1.1,
      ptt: 30,
      bilirubin_total: 0.9,
      bilirubin_direct: 0.3,
      sgot: 45,
      sgpt: 38,
      alk_phos: 210,
      ggt: 32,
      albumin: 3.8,
      na_k: '136/4.2',
      urea: 28,
      creatinine: 0.6,
      hba1c: 5.2,
    },
    drugLevels: { tac_level: 8.12, evo_level: 3.4 },
    patientReportedDoses: { neoral_tac: '2/2', everolimus: '1/0', aza_mpa: '1/1', pred: '5' },
    weightKg: 14.5,
    notes: 'Feeling well',
    ...overrides,
  });
}

describe('POST /followup/rows (create draft)', () => {
  it('persists all §7.2.1 fields and returns 201 draft', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({ method: 'POST', path: '/followup/rows', principal: patient('p1'), body: fullRowBody() })
    );
    expect(res.statusCode).toBe(201);
    const data = parse(res.body).data as Record<string, unknown>;
    expect(data.id).toBe('row-uuid-1');
    expect(data.status).toBe('draft');
    expect(data.patientId).toBe('p1');
    expect(data.ppDate).toBe('2026-06-01');
    // All three JSONB groups round-trip.
    expect(data.labValues).toMatchObject({ hb: 10.2, na_k: '136/4.2', hba1c: 5.2 });
    expect(data.drugLevels).toMatchObject({ tac_level: 8.12, evo_level: 3.4 });
    expect(data.patientReportedDoses).toMatchObject({ neoral_tac: '2/2', pred: '5' });
    expect(data.weightKg).toBe(14.5);
    expect(data.notes).toBe('Feeling well');
    // Hospital snapshot captured from the port.
    expect(data.engagementHospitalId).toBe('hosp-1');
    expect(data.engagementHospitalName).toBe('Test Hospital');
    // A draft is not submitted.
    expect(data.submittedAt).toBeNull();
  });

  it('allows partial entry (only some lab values)', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/followup/rows',
        principal: patient('p1'),
        body: JSON.stringify({
          ppDate: '2026-06-01',
          engagementHospitalId: 'hosp-1',
          labValues: { hb: 11.0 },
        }),
      })
    );
    expect(res.statusCode).toBe(201);
    const data = parse(res.body).data as Record<string, unknown>;
    expect(data.labValues).toEqual({ hb: 11.0 });
    expect(data.drugLevels).toEqual({});
    expect(data.patientReportedDoses).toEqual({});
  });

  it('REJECTS a row without engagementHospitalId (required §7.2.1)', async () => {
    const b = makeBundle();
    const body = JSON.parse(fullRowBody());
    delete body.engagementHospitalId;
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/followup/rows',
        principal: patient('p1'),
        body: JSON.stringify(body),
      })
    );
    expect(res.statusCode).toBe(400);
    const err = parse(res.body).error;
    expect(err?.code).toBe('VALIDATION_ERROR');
    expect(err?.details?.field).toBe('engagementHospitalId');
  });

  it('rejects an unknown/invalid hospital id', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/followup/rows',
        principal: patient('p1'),
        body: fullRowBody({ engagementHospitalId: 'nope' }),
      })
    );
    expect(res.statusCode).toBe(400);
    expect(parse(res.body).error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a non-numeric lab value', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/followup/rows',
        principal: patient('p1'),
        body: fullRowBody({ labValues: { hb: 'high' } }),
      })
    );
    expect(res.statusCode).toBe(400);
    expect(parse(res.body).error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an unknown lab field key', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/followup/rows',
        principal: patient('p1'),
        body: fullRowBody({ labValues: { platelets: 180 } }),
      })
    );
    expect(res.statusCode).toBe(400);
    expect(parse(res.body).error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a duplicate (patient, pp_date) with CONFLICT', async () => {
    const b = makeBundle();
    await route(
      b.deps,
      req({ method: 'POST', path: '/followup/rows', principal: patient('p1'), body: fullRowBody() })
    );
    const res = await route(
      b.deps,
      req({ method: 'POST', path: '/followup/rows', principal: patient('p1'), body: fullRowBody() })
    );
    expect(res.statusCode).toBe(409);
    expect(parse(res.body).error?.code).toBe('CONFLICT');
  });

  it('forbids a doctor from creating a row (patient flow only in WP 2.2)', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({ method: 'POST', path: '/followup/rows', principal: doctor, body: fullRowBody() })
    );
    expect(res.statusCode).toBe(403);
    expect(parse(res.body).error?.code).toBe('FORBIDDEN');
  });

  it('rejects unauthenticated requests', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({ method: 'POST', path: '/followup/rows', body: fullRowBody() })
    );
    expect(res.statusCode).toBe(401);
  });
});

describe('PATCH /followup/rows/{id} (edit draft)', () => {
  it('edits a draft and leaves other fields intact', async () => {
    const b = makeBundle();
    await route(
      b.deps,
      req({ method: 'POST', path: '/followup/rows', principal: patient('p1'), body: fullRowBody() })
    );
    const res = await route(
      b.deps,
      req({
        method: 'PATCH',
        path: '/followup/rows/row-uuid-1',
        principal: patient('p1'),
        body: JSON.stringify({ weightKg: 15.0, labValues: { hb: 10.5 } }),
      })
    );
    expect(res.statusCode).toBe(200);
    const data = parse(res.body).data as Record<string, unknown>;
    expect(data.weightKg).toBe(15.0);
    expect(data.labValues).toEqual({ hb: 10.5 });
    expect(data.notes).toBe('Feeling well');
  });

  it('DENIES editing another patient draft (404)', async () => {
    const b = makeBundle();
    await route(
      b.deps,
      req({ method: 'POST', path: '/followup/rows', principal: patient('p1'), body: fullRowBody() })
    );
    const res = await route(
      b.deps,
      req({
        method: 'PATCH',
        path: '/followup/rows/row-uuid-1',
        principal: patient('other'),
        body: JSON.stringify({ notes: 'tampered' }),
      })
    );
    expect(res.statusCode).toBe(404);
  });

  it('cannot edit a submitted (non-draft) row — surfaces 404', async () => {
    const b = makeBundle();
    await route(
      b.deps,
      req({ method: 'POST', path: '/followup/rows', principal: patient('p1'), body: fullRowBody() })
    );
    await route(
      b.deps,
      req({ method: 'PUT', path: '/followup/rows/row-uuid-1/submit', principal: patient('p1') })
    );
    const res = await route(
      b.deps,
      req({
        method: 'PATCH',
        path: '/followup/rows/row-uuid-1',
        principal: patient('p1'),
        body: JSON.stringify({ notes: 'late edit' }),
      })
    );
    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /followup/rows/{id}/submit', () => {
  it('transitions draft -> pending and stamps submittedAt', async () => {
    const b = makeBundle(new Date('2026-06-02T09:00:00.000Z'));
    await route(
      b.deps,
      req({ method: 'POST', path: '/followup/rows', principal: patient('p1'), body: fullRowBody() })
    );
    const res = await route(
      b.deps,
      req({ method: 'PUT', path: '/followup/rows/row-uuid-1/submit', principal: patient('p1') })
    );
    expect(res.statusCode).toBe(200);
    const data = parse(res.body).data as Record<string, unknown>;
    expect(data.status).toBe('pending');
    expect(data.submittedAt).toBe('2026-06-02T09:00:00.000Z');
  });

  it('rejects submitting a row with no lab values', async () => {
    const b = makeBundle();
    await route(
      b.deps,
      req({
        method: 'POST',
        path: '/followup/rows',
        principal: patient('p1'),
        body: JSON.stringify({ ppDate: '2026-06-01', engagementHospitalId: 'hosp-1' }),
      })
    );
    const res = await route(
      b.deps,
      req({ method: 'PUT', path: '/followup/rows/row-uuid-1/submit', principal: patient('p1') })
    );
    expect(res.statusCode).toBe(400);
    expect(parse(res.body).error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects submitting an already-submitted row (CONFLICT)', async () => {
    const b = makeBundle();
    await route(
      b.deps,
      req({ method: 'POST', path: '/followup/rows', principal: patient('p1'), body: fullRowBody() })
    );
    await route(
      b.deps,
      req({ method: 'PUT', path: '/followup/rows/row-uuid-1/submit', principal: patient('p1') })
    );
    const res = await route(
      b.deps,
      req({ method: 'PUT', path: '/followup/rows/row-uuid-1/submit', principal: patient('p1') })
    );
    expect(res.statusCode).toBe(409);
  });

  // WP 4.2 — submit cancels pending reminders (DoD).
  it('cancels pending reminders for the patient on submit', async () => {
    const b = makeBundle();
    b.reminders.result = { milestoneId: 'ms-1', cancelledCount: 3 };
    await route(
      b.deps,
      req({ method: 'POST', path: '/followup/rows', principal: patient('p1'), body: fullRowBody() })
    );
    const res = await route(
      b.deps,
      req({ method: 'PUT', path: '/followup/rows/row-uuid-1/submit', principal: patient('p1') })
    );
    expect(res.statusCode).toBe(200);
    // The canceller was invoked for this patient + the submitted row.
    expect(b.reminders.calls).toHaveLength(1);
    expect(b.reminders.calls[0]).toEqual({ patientId: 'p1', followUpRowId: 'row-uuid-1' });
  });

  it('submit still succeeds when there is no scheduled milestone (no-op cancel)', async () => {
    const b = makeBundle();
    // default FakeReminderCanceller result = { milestoneId: null, cancelledCount: 0 }
    await route(
      b.deps,
      req({ method: 'POST', path: '/followup/rows', principal: patient('p1'), body: fullRowBody() })
    );
    const res = await route(
      b.deps,
      req({ method: 'PUT', path: '/followup/rows/row-uuid-1/submit', principal: patient('p1') })
    );
    expect(res.statusCode).toBe(200);
    expect(parse(res.body).data).toMatchObject({ status: 'pending' });
    expect(b.reminders.calls).toHaveLength(1);
  });
});

describe('GET /followup/rows (read + list) — RLS', () => {
  it('a patient reads their own row; another patient gets 404', async () => {
    const b = makeBundle();
    await route(
      b.deps,
      req({ method: 'POST', path: '/followup/rows', principal: patient('p1'), body: fullRowBody() })
    );
    const own = await route(
      b.deps,
      req({ method: 'GET', path: '/followup/rows/row-uuid-1', principal: patient('p1') })
    );
    expect(own.statusCode).toBe(200);

    const cross = await route(
      b.deps,
      req({ method: 'GET', path: '/followup/rows/row-uuid-1', principal: patient('p2') })
    );
    expect(cross.statusCode).toBe(404);
  });

  it('list returns only the caller patient rows', async () => {
    const b = makeBundle();
    await route(
      b.deps,
      req({ method: 'POST', path: '/followup/rows', principal: patient('p1'), body: fullRowBody() })
    );
    await route(
      b.deps,
      req({
        method: 'POST',
        path: '/followup/rows',
        principal: patient('p1'),
        body: fullRowBody({ ppDate: '2026-07-01' }),
      })
    );
    await route(
      b.deps,
      req({
        method: 'POST',
        path: '/followup/rows',
        principal: patient('p2'),
        body: fullRowBody(),
      })
    );

    const res = await route(
      b.deps,
      req({ method: 'GET', path: '/followup/rows', principal: patient('p1') })
    );
    const rows = (parse(res.body).data as { rows: unknown[] }).rows;
    expect(rows).toHaveLength(2);
    // Newest pp_date first.
    expect((rows[0] as Record<string, unknown>).ppDate).toBe('2026-07-01');
  });
});

describe('routing', () => {
  it('unknown route returns 404', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({ method: 'GET', path: '/nope', principal: patient('p1') })
    );
    expect(res.statusCode).toBe(404);
  });
});
