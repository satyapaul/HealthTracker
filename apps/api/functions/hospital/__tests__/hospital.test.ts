/**
 * WP 3.3 hospital picker/read tests. All deps are injected fakes — no real
 * AWS / DB. Covers the H-07 picker (scope=affiliated | forPatient, Virtual
 * pinned first, active-only, search), access checks, GET /hospitals/{id}, and
 * GET /doctors/me/affiliations (H-05).
 */
import { describe, it, expect } from 'vitest';
import { route } from '../router';
import type { HospitalRequest, Principal } from '../http';
import { makeBundle, VIRTUAL_ID } from './fakes';
import type { HospitalSummary } from '../ports/db';

function req(
  partial: Partial<HospitalRequest> & Pick<HospitalRequest, 'method' | 'path'>
): HospitalRequest {
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
const patient = (pid: string): Principal => ({
  userId: `u-${pid}`,
  role: 'patient',
  patientId: pid,
});
const admin: Principal = { userId: 'admin-1', role: 'admin', patientId: '' };

function hospital(
  id: string,
  name: string,
  status: 'active' | 'inactive' = 'active'
): HospitalSummary {
  return {
    id,
    hospitalCode: id.toUpperCase(),
    hospitalName: name,
    hospitalType: 'general',
    city: 'City',
    logoUrl: null,
    status,
  };
}

describe('GET /hospitals — scope=affiliated (H-07)', () => {
  it('returns Virtual pinned first, then the doctor active affiliations by name', async () => {
    const b = makeBundle();
    b.db.addHospital(hospital('h-b', 'Beta Hospital'));
    b.db.addHospital(hospital('h-a', 'Alpha Hospital'));
    b.db.affiliate('d1', 'h-b');
    b.db.affiliate('d1', 'h-a');

    const res = await route(
      b.deps,
      req({
        method: 'GET',
        path: '/hospitals',
        principal: doctor('d1'),
        query: { scope: 'affiliated' },
      })
    );
    expect(res.statusCode).toBe(200);
    const list = (parse(res.body).data as { hospitals: Record<string, unknown>[] }).hospitals;
    expect(list[0]).toMatchObject({ id: VIRTUAL_ID, pinned: true });
    // Affiliated hospitals follow, name-ordered, not pinned.
    expect(list.slice(1).map((h) => h.hospitalName)).toEqual(['Alpha Hospital', 'Beta Hospital']);
    expect(list.slice(1).every((h) => h.pinned === false)).toBe(true);
  });

  it('excludes inactive hospitals', async () => {
    const b = makeBundle();
    b.db.addHospital(hospital('h1', 'Active One', 'active'));
    b.db.addHospital(hospital('h2', 'Closed One', 'inactive'));
    b.db.affiliate('d1', 'h1');
    b.db.affiliate('d1', 'h2');

    const res = await route(
      b.deps,
      req({
        method: 'GET',
        path: '/hospitals',
        principal: doctor('d1'),
        query: { scope: 'affiliated' },
      })
    );
    const names = (parse(res.body).data as { hospitals: Record<string, unknown>[] }).hospitals.map(
      (h) => h.hospitalName
    );
    expect(names).toContain('Active One');
    expect(names).not.toContain('Closed One');
  });

  it('a doctor with no affiliations still gets the Virtual Hospital', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({
        method: 'GET',
        path: '/hospitals',
        principal: doctor('lonely'),
        query: { scope: 'affiliated' },
      })
    );
    const list = (parse(res.body).data as { hospitals: Record<string, unknown>[] }).hospitals;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: VIRTUAL_ID, pinned: true });
  });

  it('rejects scope=affiliated for a non-doctor', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({
        method: 'GET',
        path: '/hospitals',
        principal: patient('p1'),
        query: { scope: 'affiliated' },
      })
    );
    expect(res.statusCode).toBe(403);
  });

  it('applies the inline search filter', async () => {
    const b = makeBundle();
    b.db.addHospital(hospital('h-a', 'Alpha Hospital'));
    b.db.addHospital(hospital('h-b', 'Beta Hospital'));
    b.db.affiliate('d1', 'h-a');
    b.db.affiliate('d1', 'h-b');
    const res = await route(
      b.deps,
      req({
        method: 'GET',
        path: '/hospitals',
        principal: doctor('d1'),
        query: { scope: 'affiliated', search: 'alpha' },
      })
    );
    const names = (parse(res.body).data as { hospitals: Record<string, unknown>[] }).hospitals.map(
      (h) => h.hospitalName
    );
    expect(names).toEqual(['Alpha Hospital']);
  });
});

describe('GET /hospitals — forPatient', () => {
  it('returns the patient primary doctor affiliations (patient views own)', async () => {
    const b = makeBundle();
    b.db.addHospital(hospital('h1', 'Primary Hosp'));
    b.db.primaryDoctor.set('p1', 'd1');
    b.db.affiliate('d1', 'h1');

    const res = await route(
      b.deps,
      req({
        method: 'GET',
        path: '/hospitals',
        principal: patient('p1'),
        query: { forPatient: 'p1' },
      })
    );
    expect(res.statusCode).toBe(200);
    const list = (parse(res.body).data as { hospitals: Record<string, unknown>[] }).hospitals;
    expect(list[0]).toMatchObject({ id: VIRTUAL_ID, pinned: true });
    expect(list.map((h) => h.hospitalName)).toContain('Primary Hosp');
  });

  it('DENIES a patient requesting another patient (403)', async () => {
    const b = makeBundle();
    b.db.primaryDoctor.set('p2', 'd1');
    const res = await route(
      b.deps,
      req({
        method: 'GET',
        path: '/hospitals',
        principal: patient('p1'),
        query: { forPatient: 'p2' },
      })
    );
    expect(res.statusCode).toBe(403);
  });

  it('allows an assigned doctor; denies an unassigned one', async () => {
    const b = makeBundle();
    b.db.primaryDoctor.set('p1', 'dPrimary');
    b.db.assign('dAssigned', 'p1');

    const ok = await route(
      b.deps,
      req({
        method: 'GET',
        path: '/hospitals',
        principal: doctor('dAssigned'),
        query: { forPatient: 'p1' },
      })
    );
    expect(ok.statusCode).toBe(200);

    const denied = await route(
      b.deps,
      req({
        method: 'GET',
        path: '/hospitals',
        principal: doctor('dOther'),
        query: { forPatient: 'p1' },
      })
    );
    expect(denied.statusCode).toBe(403);
  });

  it('admin may request any patient; Virtual-only when no primary doctor', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({ method: 'GET', path: '/hospitals', principal: admin, query: { forPatient: 'p-nodoc' } })
    );
    expect(res.statusCode).toBe(200);
    const list = (parse(res.body).data as { hospitals: Record<string, unknown>[] }).hospitals;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: VIRTUAL_ID });
  });

  it('400 when neither scope nor forPatient is supplied', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({ method: 'GET', path: '/hospitals', principal: doctor('d1'), query: {} })
    );
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /hospitals/{id} (detail)', () => {
  it('returns a hospital for any authenticated role', async () => {
    const b = makeBundle();
    b.db.addHospital(hospital('h1', 'Detail Hosp'));
    const res = await route(
      b.deps,
      req({ method: 'GET', path: '/hospitals/h1', principal: patient('p1') })
    );
    expect(res.statusCode).toBe(200);
    expect((parse(res.body).data as Record<string, string>).hospitalName).toBe('Detail Hosp');
  });

  it('404 for an unknown hospital', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({ method: 'GET', path: '/hospitals/nope', principal: patient('p1') })
    );
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /doctors/me/affiliations (H-05)', () => {
  it('returns the doctor own affiliations', async () => {
    const b = makeBundle();
    b.db.affiliationViews.set('d1', [
      {
        affiliationId: 'a1',
        hospital: { id: 'h1', hospitalName: 'Primary Hosp', hospitalCode: 'H1' },
        roleAtHospital: 'Surgeon',
        isPrimary: true,
        status: 'active',
      },
    ]);
    const res = await route(
      b.deps,
      req({ method: 'GET', path: '/doctors/me/affiliations', principal: doctor('d1') })
    );
    expect(res.statusCode).toBe(200);
    const list = (parse(res.body).data as { affiliations: unknown[] }).affiliations;
    expect(list).toHaveLength(1);
    expect((list[0] as Record<string, unknown>).isPrimary).toBe(true);
  });

  it('forbids a non-doctor', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({ method: 'GET', path: '/doctors/me/affiliations', principal: patient('p1') })
    );
    expect(res.statusCode).toBe(403);
  });
});
