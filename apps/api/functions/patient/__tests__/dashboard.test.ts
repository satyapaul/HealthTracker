/**
 * WP 3.4 doctor-dashboard tests (spec D-13, §8.9): GET /patients for a doctor
 * returns their assigned patients with pending-submission badges, filterable by
 * ?hospital_id to patients with at least one engagement at that hospital.
 * All deps are injected fakes — no real AWS / DB.
 */
import { describe, it, expect } from 'vitest';
import { route } from '../router';
import type { PatientRequest, Principal } from '../http';
import { makeBundle, FakeDb } from './fakes';
import type { PatientRecord } from '../ports/db';

function req(
  partial: Partial<PatientRequest> & Pick<PatientRequest, 'method' | 'path'>
): PatientRequest {
  return { headers: {}, body: null, principal: null, pathParams: {}, query: {}, ...partial };
}

function parse(body: string): {
  success: boolean;
  data: Record<string, unknown> | null;
  error: { code: string } | null;
} {
  return JSON.parse(body);
}

const doctor = (id: string): Principal => ({ userId: id, role: 'doctor', patientId: '' });
const admin: Principal = { userId: 'admin-1', role: 'admin', patientId: '' };

const H_SHMS = '11111111-1111-1111-1111-111111111111';
const H_AIIMS = '22222222-2222-2222-2222-222222222222';

/** Seed a bare patient chart row directly into the fake. */
function seedPatient(db: FakeDb, id: string, name: string): void {
  const rec: PatientRecord = {
    id,
    name,
    ageYears: null,
    sex: null,
    maxId: `MAX-${id}`,
    photoUrl: null,
    dateOfOperation: null,
    diagnosis: null,
    histopathology: null,
    anastomosisType: null,
    contactEmail: null,
    phoneNumber: null,
    whatsappNumber: null,
    reminderPreferences: { smsEnabled: true, whatsappEnabled: true, timezone: 'Asia/Kolkata' },
    reminderOptOut: false,
    procedureHospitalId: null,
    defaultFollowupHospitalId: null,
    primaryDoctorId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  db.rows.set(id, rec);
}

describe('GET /patients — doctor dashboard (D-13)', () => {
  it('lists the doctor assigned patients with pending-submission badges', async () => {
    const b = makeBundle();
    seedPatient(b.db, 'p1', 'Alice');
    seedPatient(b.db, 'p2', 'Bob');
    b.db.assign('d1', 'p1');
    b.db.assign('d1', 'p2');
    // p1 has 2 pending engagements at SHMS; p2 has a reviewed one at AIIMS.
    b.db.addEngagement('p1', H_SHMS, true);
    b.db.addEngagement('p1', H_SHMS, true);
    b.db.addEngagement('p2', H_AIIMS, false);

    const res = await route(
      b.deps,
      req({ method: 'GET', path: '/patients', principal: doctor('d1') })
    );
    expect(res.statusCode).toBe(200);
    const list = (parse(res.body).data as { patients: Record<string, unknown>[] }).patients;
    expect(list).toHaveLength(2);
    const p1 = list.find((e) => (e.patient as Record<string, unknown>).id === 'p1') as Record<
      string,
      unknown
    >;
    expect(p1.pendingSubmissionCount).toBe(2);
    expect(p1.hasPending).toBe(true);
    const p2 = list.find((e) => (e.patient as Record<string, unknown>).id === 'p2') as Record<
      string,
      unknown
    >;
    expect(p2.pendingSubmissionCount).toBe(0);
    expect(p2.hasPending).toBe(false);
  });

  it('filters to patients with at least one engagement at the given hospital (DoD)', async () => {
    const b = makeBundle();
    seedPatient(b.db, 'p1', 'Alice');
    seedPatient(b.db, 'p2', 'Bob');
    b.db.assign('d1', 'p1');
    b.db.assign('d1', 'p2');
    b.db.addEngagement('p1', H_SHMS, true);
    b.db.addEngagement('p2', H_AIIMS, false);

    const res = await route(
      b.deps,
      req({
        method: 'GET',
        path: '/patients',
        principal: doctor('d1'),
        query: { hospital_id: H_SHMS },
      })
    );
    const list = (parse(res.body).data as { patients: Record<string, unknown>[] }).patients;
    expect(list).toHaveLength(1);
    expect(((list[0] as Record<string, unknown>).patient as Record<string, unknown>).id).toBe('p1');
  });

  it('no filter returns all assigned patients', async () => {
    const b = makeBundle();
    seedPatient(b.db, 'p1', 'Alice');
    seedPatient(b.db, 'p2', 'Bob');
    b.db.assign('d1', 'p1');
    b.db.assign('d1', 'p2');
    b.db.addEngagement('p1', H_SHMS, false);
    b.db.addEngagement('p2', H_AIIMS, false);

    const res = await route(
      b.deps,
      req({ method: 'GET', path: '/patients', principal: doctor('d1') })
    );
    const list = (parse(res.body).data as { patients: unknown[] }).patients;
    expect(list).toHaveLength(2);
  });

  it('only returns the calling doctor own assigned patients (isolation)', async () => {
    const b = makeBundle();
    seedPatient(b.db, 'p1', 'Alice');
    seedPatient(b.db, 'p2', 'Bob');
    b.db.assign('d1', 'p1');
    b.db.assign('d2', 'p2'); // assigned to a different doctor
    b.db.addEngagement('p1', H_SHMS, true);
    b.db.addEngagement('p2', H_SHMS, true);

    const res = await route(
      b.deps,
      req({ method: 'GET', path: '/patients', principal: doctor('d1') })
    );
    const list = (parse(res.body).data as { patients: Record<string, unknown>[] }).patients;
    expect(list).toHaveLength(1);
    expect(((list[0] as Record<string, unknown>).patient as Record<string, unknown>).id).toBe('p1');
  });

  it('a hospital with no matching engagements yields an empty dashboard', async () => {
    const b = makeBundle();
    seedPatient(b.db, 'p1', 'Alice');
    b.db.assign('d1', 'p1');
    b.db.addEngagement('p1', H_SHMS, true);

    const res = await route(
      b.deps,
      req({
        method: 'GET',
        path: '/patients',
        principal: doctor('d1'),
        query: { hospital_id: H_AIIMS },
      })
    );
    const list = (parse(res.body).data as { patients: unknown[] }).patients;
    expect(list).toHaveLength(0);
  });

  it('admin GET /patients keeps the plain chart list (not the dashboard shape)', async () => {
    const b = makeBundle();
    seedPatient(b.db, 'p1', 'Alice');
    const res = await route(b.deps, req({ method: 'GET', path: '/patients', principal: admin }));
    expect(res.statusCode).toBe(200);
    const list = (parse(res.body).data as { patients: Record<string, unknown>[] }).patients;
    // Admin list returns PatientRecord objects directly (id at top level),
    // not the { patient, pendingSubmissionCount } dashboard wrapper.
    expect(list[0].id).toBe('p1');
    expect(list[0].patient).toBeUndefined();
  });
});
