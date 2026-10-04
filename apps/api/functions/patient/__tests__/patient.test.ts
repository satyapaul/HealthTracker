/**
 * WP 2.1 patient-chart Lambda unit tests. All dependencies are injected fakes —
 * no real AWS / DB. Covers the DoD (chart create/read with ALL header fields)
 * plus the must-test invariants (cross-patient access denied; admin access;
 * required-field validation; default-follow-up-hospital rule).
 */
import { describe, it, expect } from 'vitest';
import { route } from '../router';
import type { PatientRequest, Principal } from '../http';
import { makeBundle } from './fakes';

function req(
  partial: Partial<PatientRequest> & Pick<PatientRequest, 'method' | 'path'>
): PatientRequest {
  return { headers: {}, body: null, principal: null, pathParams: {}, query: {}, ...partial };
}

function parse(body: string): {
  success: boolean;
  data: Record<string, unknown> | null;
  error: { code: string; details?: Record<string, unknown> } | null;
} {
  return JSON.parse(body);
}

const admin: Principal = { userId: 'admin-1', role: 'admin', patientId: '' };
const doctor: Principal = { userId: 'doctor-1', role: 'doctor', patientId: '' };
function patientPrincipal(patientId: string): Principal {
  return { userId: `user-${patientId}`, role: 'patient', patientId };
}

/** A complete §7.1 chart-header payload (all required fields present). */
function fullChartBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: 'Test Patient',
    ageYears: 4.5,
    sex: 'M',
    maxId: 'SHMS.750590',
    dateOfOperation: '2026-05-26',
    diagnosis: 'DCLD',
    histopathology: 'Biliary Cirrhosis',
    anastomosisType: 'Roux-en-Y',
    contactEmail: 'doc@example.com',
    procedureHospitalId: '11111111-1111-1111-1111-111111111111',
    ...overrides,
  });
}

describe('POST /patients (create chart)', () => {
  it('admin creates a chart with all header fields and gets 201', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({ method: 'POST', path: '/patients', principal: admin, body: fullChartBody() })
    );

    expect(res.statusCode).toBe(201);
    const env = parse(res.body);
    expect(env.success).toBe(true);
    const data = env.data as Record<string, unknown>;
    expect(data.id).toBe('patient-uuid-1');
    expect(data.name).toBe('Test Patient');
    expect(data.ageYears).toBe(4.5);
    expect(data.sex).toBe('M');
    expect(data.maxId).toBe('SHMS.750590');
    expect(data.diagnosis).toBe('DCLD');
    expect(data.histopathology).toBe('Biliary Cirrhosis');
    expect(data.anastomosisType).toBe('Roux-en-Y');
    expect(data.procedureHospitalId).toBe('11111111-1111-1111-1111-111111111111');
    // default_followup defaults to procedure hospital when unset (§7.1).
    expect(data.defaultFollowupHospitalId).toBe('11111111-1111-1111-1111-111111111111');
    // Reminder prefs default applied.
    expect(data.reminderPreferences).toEqual({
      smsEnabled: true,
      whatsappEnabled: true,
      timezone: 'Asia/Kolkata',
    });
    expect(data.reminderOptOut).toBe(false);
  });

  it('honors an explicit defaultFollowupHospitalId (override of the default rule)', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/patients',
        principal: admin,
        body: fullChartBody({
          defaultFollowupHospitalId: '22222222-2222-2222-2222-222222222222',
        }),
      })
    );
    const data = parse(res.body).data as Record<string, unknown>;
    expect(data.defaultFollowupHospitalId).toBe('22222222-2222-2222-2222-222222222222');
    expect(data.procedureHospitalId).toBe('11111111-1111-1111-1111-111111111111');
  });

  it.each([
    ['name'],
    ['maxId'],
    ['ageYears'],
    ['sex'],
    ['dateOfOperation'],
    ['diagnosis'],
    ['histopathology'],
    ['anastomosisType'],
    ['contactEmail'],
    ['procedureHospitalId'],
  ])('rejects a chart missing required field %s with VALIDATION_ERROR', async (field) => {
    const b = makeBundle();
    const body = JSON.parse(fullChartBody());
    delete body[field];
    const res = await route(
      b.deps,
      req({ method: 'POST', path: '/patients', principal: admin, body: JSON.stringify(body) })
    );
    expect(res.statusCode).toBe(400);
    expect(parse(res.body).error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an invalid sex value', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/patients',
        principal: admin,
        body: fullChartBody({ sex: 'X' }),
      })
    );
    expect(res.statusCode).toBe(400);
    expect(parse(res.body).error?.code).toBe('VALIDATION_ERROR');
  });

  it('forbids a non-admin (patient) from creating a chart', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/patients',
        principal: patientPrincipal('patient-uuid-1'),
        body: fullChartBody(),
      })
    );
    expect(res.statusCode).toBe(403);
    expect(parse(res.body).error?.code).toBe('FORBIDDEN');
  });

  it('rejects a duplicate max_id with CONFLICT', async () => {
    const b = makeBundle();
    await route(
      b.deps,
      req({ method: 'POST', path: '/patients', principal: admin, body: fullChartBody() })
    );
    const res = await route(
      b.deps,
      req({ method: 'POST', path: '/patients', principal: admin, body: fullChartBody() })
    );
    expect(res.statusCode).toBe(409);
    expect(parse(res.body).error?.code).toBe('CONFLICT');
  });

  it('rejects an unauthenticated request (no principal)', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({ method: 'POST', path: '/patients', body: fullChartBody() })
    );
    expect(res.statusCode).toBe(401);
    expect(parse(res.body).error?.code).toBe('UNAUTHENTICATED');
  });
});

describe('GET /patients/{id} (read chart) — RLS', () => {
  it('a patient can read their own chart', async () => {
    const b = makeBundle();
    // Admin creates the chart.
    await route(
      b.deps,
      req({ method: 'POST', path: '/patients', principal: admin, body: fullChartBody() })
    );
    const id = 'patient-uuid-1';

    const res = await route(
      b.deps,
      req({ method: 'GET', path: `/patients/${id}`, principal: patientPrincipal(id) })
    );
    expect(res.statusCode).toBe(200);
    expect((parse(res.body).data as Record<string, unknown>).id).toBe(id);
  });

  it('DENIES cross-patient access (another patient sees 404, not the row)', async () => {
    const b = makeBundle();
    await route(
      b.deps,
      req({ method: 'POST', path: '/patients', principal: admin, body: fullChartBody() })
    );
    const id = 'patient-uuid-1';

    // A different patient tries to read it.
    const res = await route(
      b.deps,
      req({
        method: 'GET',
        path: `/patients/${id}`,
        principal: patientPrincipal('some-other-patient'),
      })
    );
    expect(res.statusCode).toBe(404);
    expect(parse(res.body).error?.code).toBe('NOT_FOUND');
  });

  it('a doctor cannot read a chart yet (care-team policy deferred to Phase 6)', async () => {
    const b = makeBundle();
    await route(
      b.deps,
      req({ method: 'POST', path: '/patients', principal: admin, body: fullChartBody() })
    );
    const res = await route(
      b.deps,
      req({ method: 'GET', path: '/patients/patient-uuid-1', principal: doctor })
    );
    expect(res.statusCode).toBe(404);
  });

  it('admin can read any chart', async () => {
    const b = makeBundle();
    await route(
      b.deps,
      req({ method: 'POST', path: '/patients', principal: admin, body: fullChartBody() })
    );
    const res = await route(
      b.deps,
      req({ method: 'GET', path: '/patients/patient-uuid-1', principal: admin })
    );
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /patients (list) — RLS scope', () => {
  it('a patient lists only their own chart', async () => {
    const b = makeBundle();
    // Two charts created by admin.
    await route(
      b.deps,
      req({ method: 'POST', path: '/patients', principal: admin, body: fullChartBody() })
    );
    await route(
      b.deps,
      req({
        method: 'POST',
        path: '/patients',
        principal: admin,
        body: fullChartBody({ maxId: 'SHMS.000002' }),
      })
    );

    const res = await route(
      b.deps,
      req({ method: 'GET', path: '/patients', principal: patientPrincipal('patient-uuid-1') })
    );
    expect(res.statusCode).toBe(200);
    const patients = (parse(res.body).data as { patients: unknown[] }).patients;
    expect(patients).toHaveLength(1);
    expect((patients[0] as Record<string, unknown>).id).toBe('patient-uuid-1');
  });

  it('admin lists all charts', async () => {
    const b = makeBundle();
    await route(
      b.deps,
      req({ method: 'POST', path: '/patients', principal: admin, body: fullChartBody() })
    );
    await route(
      b.deps,
      req({
        method: 'POST',
        path: '/patients',
        principal: admin,
        body: fullChartBody({ maxId: 'SHMS.000002' }),
      })
    );
    const res = await route(b.deps, req({ method: 'GET', path: '/patients', principal: admin }));
    const patients = (parse(res.body).data as { patients: unknown[] }).patients;
    expect(patients).toHaveLength(2);
  });
});

describe('PATCH /patients/{id} (update)', () => {
  it('a patient updates their own chart; updatedAt advances', async () => {
    const b = makeBundle(new Date('2026-01-01T00:00:00.000Z'));
    await route(
      b.deps,
      req({ method: 'POST', path: '/patients', principal: admin, body: fullChartBody() })
    );
    const id = 'patient-uuid-1';

    const res = await route(
      b.deps,
      req({
        method: 'PATCH',
        path: `/patients/${id}`,
        principal: patientPrincipal(id),
        body: JSON.stringify({ phoneNumber: '+919000000000', reminderOptOut: true }),
      })
    );
    expect(res.statusCode).toBe(200);
    const data = parse(res.body).data as Record<string, unknown>;
    expect(data.phoneNumber).toBe('+919000000000');
    expect(data.reminderOptOut).toBe(true);
    // Unchanged fields preserved.
    expect(data.name).toBe('Test Patient');
  });

  it('DENIES a patient updating another patient chart (404)', async () => {
    const b = makeBundle();
    await route(
      b.deps,
      req({ method: 'POST', path: '/patients', principal: admin, body: fullChartBody() })
    );
    const res = await route(
      b.deps,
      req({
        method: 'PATCH',
        path: '/patients/patient-uuid-1',
        principal: patientPrincipal('other-patient'),
        body: JSON.stringify({ diagnosis: 'tampered' }),
      })
    );
    expect(res.statusCode).toBe(404);
  });

  it('forbids a doctor from updating a chart in this phase', async () => {
    const b = makeBundle();
    await route(
      b.deps,
      req({ method: 'POST', path: '/patients', principal: admin, body: fullChartBody() })
    );
    const res = await route(
      b.deps,
      req({
        method: 'PATCH',
        path: '/patients/patient-uuid-1',
        principal: doctor,
        body: JSON.stringify({ diagnosis: 'x' }),
      })
    );
    expect(res.statusCode).toBe(403);
    expect(parse(res.body).error?.code).toBe('FORBIDDEN');
  });

  it('rejects an empty update (no fields) with VALIDATION_ERROR', async () => {
    const b = makeBundle();
    await route(
      b.deps,
      req({ method: 'POST', path: '/patients', principal: admin, body: fullChartBody() })
    );
    const res = await route(
      b.deps,
      req({
        method: 'PATCH',
        path: '/patients/patient-uuid-1',
        principal: patientPrincipal('patient-uuid-1'),
        body: JSON.stringify({}),
      })
    );
    expect(res.statusCode).toBe(400);
    expect(parse(res.body).error?.code).toBe('VALIDATION_ERROR');
  });
});

describe('routing', () => {
  it('unknown route returns 404 NOT_FOUND', async () => {
    const b = makeBundle();
    const res = await route(b.deps, req({ method: 'GET', path: '/nope', principal: admin }));
    expect(res.statusCode).toBe(404);
  });
});
