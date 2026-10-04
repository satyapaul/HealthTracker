/**
 * Doctor/admin read of a patient's follow-up rows:
 *   GET /followup/patients/{patientId}/rows
 *
 * Authorization is RLS-enforced via doctor_patient_assignments (V6
 * fur_doctor_select). These unit tests use the followup FakeDb, which models
 * that join: an assigned doctor sees the patient's rows, an unassigned doctor
 * sees none (no leak), admins see all, and patient/caregiver roles are rejected.
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
  data: { rows?: unknown[] } | null;
  error: { code: string } | null;
} {
  return JSON.parse(body);
}

const patient = (patientId: string): Principal => ({
  userId: `user-${patientId}`,
  role: 'patient',
  patientId,
});
const doctor = (userId: string): Principal => ({ userId, role: 'doctor', patientId: '' });
const admin: Principal = { userId: 'admin-1', role: 'admin', patientId: '' };

/** Seed two submitted rows for p1 directly in the fake store. */
function seedTwoRows(b: ReturnType<typeof makeBundle>): void {
  const base = {
    patientId: 'p1',
    status: 'pending' as const,
    labValues: { hb: 12.1 },
    drugLevels: {},
    patientReportedDoses: {},
    doctorPrescribedDoses: null,
    weightKg: null,
    notes: null,
    engagementHospitalId: 'hosp-1',
    engagementHospitalName: 'Test Hospital',
    submittedAt: '2026-06-01T00:00:00.000Z',
    reviewedAt: null,
    reviewedBy: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
  b.db.rows.set('r1', { ...base, id: 'r1', ppDate: '2026-06-01' });
  b.db.rows.set('r2', { ...base, id: 'r2', ppDate: '2026-06-15' });
}

const PATH = '/followup/patients/p1/rows';

describe('GET /followup/patients/{patientId}/rows', () => {
  it('returns the patient rows for an ASSIGNED doctor (200)', async () => {
    const b = makeBundle();
    seedTwoRows(b);
    b.db.assign('doctor-1', 'p1');

    const res = await route(
      b.deps,
      req({ method: 'GET', path: PATH, principal: doctor('doctor-1') })
    );
    expect(res.statusCode).toBe(200);
    const body = parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data?.rows).toHaveLength(2);
  });

  it('returns an EMPTY list for an unassigned doctor (RLS, no leak) (200)', async () => {
    const b = makeBundle();
    seedTwoRows(b);
    // doctor-2 is NOT assigned to p1.

    const res = await route(
      b.deps,
      req({ method: 'GET', path: PATH, principal: doctor('doctor-2') })
    );
    expect(res.statusCode).toBe(200);
    const body = parse(res.body);
    expect(body.data?.rows).toHaveLength(0);
  });

  it('lets an admin read any patient rows (200)', async () => {
    const b = makeBundle();
    seedTwoRows(b);

    const res = await route(b.deps, req({ method: 'GET', path: PATH, principal: admin }));
    expect(res.statusCode).toBe(200);
    expect(parse(res.body).data?.rows).toHaveLength(2);
  });

  it('rejects a patient/caregiver on the doctor route (403)', async () => {
    const b = makeBundle();
    seedTwoRows(b);

    const res = await route(b.deps, req({ method: 'GET', path: PATH, principal: patient('p1') }));
    expect(res.statusCode).toBe(403);
    expect(parse(res.body).error?.code).toBe('FORBIDDEN');
  });

  it('requires authentication (401)', async () => {
    const b = makeBundle();
    const res = await route(b.deps, req({ method: 'GET', path: PATH }));
    expect(res.statusCode).toBe(401);
  });
});
