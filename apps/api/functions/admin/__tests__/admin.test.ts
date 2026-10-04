/**
 * WP 3.2 admin hospital-registry tests. All deps are injected fakes — no real
 * AWS / DB. Covers the H-01..H-04/H-09 endpoints, the Virtual-Hospital guards,
 * and the DoD (deactivation does not mutate historical engagement rows).
 */
import { describe, it, expect } from 'vitest';
import { route } from '../router';
import type { AdminRequest, Principal } from '../http';
import { makeBundle } from './fakes';

function req(partial: Partial<AdminRequest> & Pick<AdminRequest, 'method' | 'path'>): AdminRequest {
  return { headers: {}, body: null, principal: null, pathParams: {}, query: {}, ...partial };
}

function parse(body: string): {
  success: boolean;
  data: Record<string, unknown> | null;
  error: { code: string } | null;
} {
  return JSON.parse(body);
}

const admin: Principal = { userId: 'admin-1', role: 'admin', patientId: '' };
const doctor: Principal = { userId: 'doctor-1', role: 'doctor', patientId: '' };
const VIRTUAL_ID = '00000000-0000-0000-0000-000000000000';

function createBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    hospitalCode: 'AIIMS-DEL',
    hospitalName: 'AIIMS Delhi',
    hospitalType: 'general',
    addressLine1: 'Ansari Nagar',
    city: 'New Delhi',
    country: 'IN',
    ...overrides,
  });
}

describe('POST /admin/hospitals (H-01)', () => {
  it('admin creates a hospital -> 201', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({ method: 'POST', path: '/admin/hospitals', principal: admin, body: createBody() })
    );
    expect(res.statusCode).toBe(201);
    const data = parse(res.body).data as Record<string, string>;
    expect(data.hospitalCode).toBe('AIIMS-DEL');
    expect(data.status).toBe('active');
  });

  it('forbids a non-admin', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({ method: 'POST', path: '/admin/hospitals', principal: doctor, body: createBody() })
    );
    expect(res.statusCode).toBe(403);
  });

  it('rejects the reserved code VIRTUAL', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/admin/hospitals',
        principal: admin,
        body: createBody({ hospitalCode: 'VIRTUAL' }),
      })
    );
    expect(res.statusCode).toBe(400);
  });

  it('rejects creating a virtual-type hospital', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/admin/hospitals',
        principal: admin,
        body: createBody({ hospitalType: 'virtual' }),
      })
    );
    expect(res.statusCode).toBe(400);
  });

  it('rejects a non-virtual hospital missing address/city/country', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/admin/hospitals',
        principal: admin,
        body: JSON.stringify({ hospitalCode: 'X1', hospitalName: 'X', hospitalType: 'clinic' }),
      })
    );
    expect(res.statusCode).toBe(400);
  });

  it('rejects a duplicate hospital code -> 409', async () => {
    const b = makeBundle();
    await route(
      b.deps,
      req({ method: 'POST', path: '/admin/hospitals', principal: admin, body: createBody() })
    );
    const res = await route(
      b.deps,
      req({ method: 'POST', path: '/admin/hospitals', principal: admin, body: createBody() })
    );
    expect(res.statusCode).toBe(409);
  });
});

describe('PUT /admin/hospitals/{id} (H-02)', () => {
  it('edits a hospital name', async () => {
    const b = makeBundle();
    const created = await route(
      b.deps,
      req({ method: 'POST', path: '/admin/hospitals', principal: admin, body: createBody() })
    );
    const id = (parse(created.body).data as Record<string, string>).id;
    const res = await route(
      b.deps,
      req({
        method: 'PUT',
        path: `/admin/hospitals/${id}`,
        principal: admin,
        body: JSON.stringify({ hospitalName: 'AIIMS New Delhi' }),
      })
    );
    expect(res.statusCode).toBe(200);
    expect((parse(res.body).data as Record<string, string>).hospitalName).toBe('AIIMS New Delhi');
  });

  it('ignores immutable id/hospitalCode in the body (whitelist)', async () => {
    const b = makeBundle();
    const created = await route(
      b.deps,
      req({ method: 'POST', path: '/admin/hospitals', principal: admin, body: createBody() })
    );
    const id = (parse(created.body).data as Record<string, string>).id;
    const res = await route(
      b.deps,
      req({
        method: 'PUT',
        path: `/admin/hospitals/${id}`,
        principal: admin,
        body: JSON.stringify({ id: 'hacked', hospitalCode: 'HACKED', hospitalName: 'Renamed' }),
      })
    );
    expect(res.statusCode).toBe(200);
    const data = parse(res.body).data as Record<string, string>;
    expect(data.id).toBe(id); // unchanged
    expect(data.hospitalCode).toBe('AIIMS-DEL'); // unchanged
    expect(data.hospitalName).toBe('Renamed');
  });

  it('forbids editing the Virtual Hospital -> 403', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({
        method: 'PUT',
        path: `/admin/hospitals/${VIRTUAL_ID}`,
        principal: admin,
        body: JSON.stringify({ hospitalName: 'Hacked Virtual' }),
      })
    );
    expect(res.statusCode).toBe(403);
  });

  it('404 for an unknown hospital', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({
        method: 'PUT',
        path: '/admin/hospitals/nope',
        principal: admin,
        body: JSON.stringify({ hospitalName: 'X' }),
      })
    );
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /admin/hospitals/{id}/status (H-03) + DoD', () => {
  it('deactivates a hospital and does NOT mutate historical engagement rows', async () => {
    const b = makeBundle();
    const created = await route(
      b.deps,
      req({ method: 'POST', path: '/admin/hospitals', principal: admin, body: createBody() })
    );
    const id = (parse(created.body).data as Record<string, string>).id;
    // A historical follow-up row already references this hospital (snapshot).
    b.db.followUpSnapshots.push({ rowId: 'fur-1', engagementHospitalId: id });

    const res = await route(
      b.deps,
      req({
        method: 'PATCH',
        path: `/admin/hospitals/${id}/status`,
        principal: admin,
        body: JSON.stringify({ status: 'inactive' }),
      })
    );
    expect(res.statusCode).toBe(200);
    expect((parse(res.body).data as Record<string, string>).status).toBe('inactive');
    // DoD: the historical row's engagement hospital is unchanged.
    expect(b.db.followUpSnapshots[0].engagementHospitalId).toBe(id);
  });

  it('forbids deactivating the Virtual Hospital -> 403', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({
        method: 'PATCH',
        path: `/admin/hospitals/${VIRTUAL_ID}/status`,
        principal: admin,
        body: JSON.stringify({ status: 'inactive' }),
      })
    );
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /admin/hospitals (H-09 search)', () => {
  it('filters by search term and status', async () => {
    const b = makeBundle();
    await route(
      b.deps,
      req({ method: 'POST', path: '/admin/hospitals', principal: admin, body: createBody() })
    );
    await route(
      b.deps,
      req({
        method: 'POST',
        path: '/admin/hospitals',
        principal: admin,
        body: createBody({
          hospitalCode: 'APOLLO',
          hospitalName: 'Apollo Chennai',
          city: 'Chennai',
        }),
      })
    );
    const res = await route(
      b.deps,
      req({
        method: 'GET',
        path: '/admin/hospitals',
        principal: admin,
        query: { search: 'apollo' },
      })
    );
    expect(res.statusCode).toBe(200);
    const list = (parse(res.body).data as { hospitals: unknown[] }).hospitals;
    expect(list).toHaveLength(1);
    expect((list[0] as Record<string, string>).hospitalName).toBe('Apollo Chennai');
  });
});

describe('affiliations (H-04)', () => {
  async function createHospital(b: ReturnType<typeof makeBundle>): Promise<string> {
    const res = await route(
      b.deps,
      req({ method: 'POST', path: '/admin/hospitals', principal: admin, body: createBody() })
    );
    return (parse(res.body).data as Record<string, string>).id;
  }

  it('adds an affiliation for a doctor -> 201', async () => {
    const b = makeBundle();
    b.db.users.set('d1', 'doctor');
    const hid = await createHospital(b);
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: `/admin/hospitals/${hid}/affiliations`,
        principal: admin,
        body: JSON.stringify({ doctorId: 'd1', roleAtHospital: 'Surgeon', isPrimary: true }),
      })
    );
    expect(res.statusCode).toBe(201);
    expect((parse(res.body).data as Record<string, string>).status).toBe('active');
  });

  it('404 when the target user is not found', async () => {
    const b = makeBundle();
    const hid = await createHospital(b);
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: `/admin/hospitals/${hid}/affiliations`,
        principal: admin,
        body: JSON.stringify({ doctorId: 'ghost' }),
      })
    );
    expect(res.statusCode).toBe(404);
  });

  it('rejects a non-doctor target user', async () => {
    const b = makeBundle();
    b.db.users.set('p1', 'patient');
    const hid = await createHospital(b);
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: `/admin/hospitals/${hid}/affiliations`,
        principal: admin,
        body: JSON.stringify({ doctorId: 'p1' }),
      })
    );
    expect(res.statusCode).toBe(400);
  });

  it('rejects a duplicate affiliation -> 409', async () => {
    const b = makeBundle();
    b.db.users.set('d1', 'doctor');
    const hid = await createHospital(b);
    const body = JSON.stringify({ doctorId: 'd1' });
    await route(
      b.deps,
      req({ method: 'POST', path: `/admin/hospitals/${hid}/affiliations`, principal: admin, body })
    );
    const res = await route(
      b.deps,
      req({ method: 'POST', path: `/admin/hospitals/${hid}/affiliations`, principal: admin, body })
    );
    expect(res.statusCode).toBe(409);
  });

  it('rejects a second primary affiliation -> 409', async () => {
    const b = makeBundle();
    b.db.users.set('d1', 'doctor');
    const h1 = await createHospital(b);
    // second hospital
    const h2res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/admin/hospitals',
        principal: admin,
        body: createBody({ hospitalCode: 'H2', hospitalName: 'Second' }),
      })
    );
    const h2 = (parse(h2res.body).data as Record<string, string>).id;

    await route(
      b.deps,
      req({
        method: 'POST',
        path: `/admin/hospitals/${h1}/affiliations`,
        principal: admin,
        body: JSON.stringify({ doctorId: 'd1', isPrimary: true }),
      })
    );
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: `/admin/hospitals/${h2}/affiliations`,
        principal: admin,
        body: JSON.stringify({ doctorId: 'd1', isPrimary: true }),
      })
    );
    expect(res.statusCode).toBe(409);
  });

  it('deactivates an affiliation via PATCH', async () => {
    const b = makeBundle();
    b.db.users.set('d1', 'doctor');
    const hid = await createHospital(b);
    const addRes = await route(
      b.deps,
      req({
        method: 'POST',
        path: `/admin/hospitals/${hid}/affiliations`,
        principal: admin,
        body: JSON.stringify({ doctorId: 'd1' }),
      })
    );
    const affId = (parse(addRes.body).data as Record<string, string>).affiliationId;
    const res = await route(
      b.deps,
      req({
        method: 'PATCH',
        path: `/admin/affiliations/${affId}`,
        principal: admin,
        body: JSON.stringify({ status: 'inactive' }),
      })
    );
    expect(res.statusCode).toBe(200);
    expect((parse(res.body).data as Record<string, string>).status).toBe('inactive');
  });

  it('404 patching an unknown affiliation', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({
        method: 'PATCH',
        path: '/admin/affiliations/nope',
        principal: admin,
        body: JSON.stringify({ status: 'inactive' }),
      })
    );
    expect(res.statusCode).toBe(404);
  });
});
