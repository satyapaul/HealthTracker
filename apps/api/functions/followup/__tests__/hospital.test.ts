/**
 * WP 3.1 hospital-resolution tests — the engagement-hospital rule (spec §7.2.1):
 * a hospital is valid for an engagement iff it is the Virtual Hospital OR an
 * active affiliation of the patient's primary doctor. Driven through
 * DbHospitalPort over a fake HospitalLookup (no DB).
 */
import { describe, it, expect } from 'vitest';
import { DbHospitalPort, VIRTUAL_HOSPITAL_ID, type HospitalLookup } from '../ports/hospital';

interface Hospital {
  id: string;
  name: string;
  isActive: boolean;
}

/** In-memory HospitalLookup: hospitals, patient->primaryDoctor, affiliations. */
class FakeHospitalLookup implements HospitalLookup {
  hospitals = new Map<string, Hospital>();
  primaryDoctor = new Map<string, string>(); // patientId -> doctorId
  activeAffiliations = new Set<string>(); // `${doctorId}:${hospitalId}`

  async getHospital(id: string): Promise<Hospital | null> {
    return this.hospitals.get(id) ?? null;
  }
  async getPrimaryDoctorId(patientId: string): Promise<string | null> {
    return this.primaryDoctor.get(patientId) ?? null;
  }
  async hasActiveAffiliation(doctorId: string, hospitalId: string): Promise<boolean> {
    return this.activeAffiliations.has(`${doctorId}:${hospitalId}`);
  }
}

function setup(): { port: DbHospitalPort; lookup: FakeHospitalLookup } {
  const lookup = new FakeHospitalLookup();
  // Virtual Hospital is always present (system-seeded).
  lookup.hospitals.set(VIRTUAL_HOSPITAL_ID, {
    id: VIRTUAL_HOSPITAL_ID,
    name: 'Virtual / Remote Consultation',
    isActive: true,
  });
  return { port: new DbHospitalPort(lookup), lookup };
}

describe('DbHospitalPort.resolveForEngagement', () => {
  it('always allows the Virtual Hospital (no affiliation needed)', async () => {
    const { port } = setup();
    const ref = await port.resolveForEngagement('p1', VIRTUAL_HOSPITAL_ID);
    expect(ref).toEqual({ id: VIRTUAL_HOSPITAL_ID, name: 'Virtual / Remote Consultation' });
  });

  it('allows a hospital that is an active affiliation of the patient primary doctor', async () => {
    const { port, lookup } = setup();
    lookup.hospitals.set('h1', { id: 'h1', name: 'AIIMS Delhi', isActive: true });
    lookup.primaryDoctor.set('p1', 'd1');
    lookup.activeAffiliations.add('d1:h1');

    const ref = await port.resolveForEngagement('p1', 'h1');
    expect(ref).toEqual({ id: 'h1', name: 'AIIMS Delhi' });
  });

  it('rejects a hospital the primary doctor is NOT affiliated with', async () => {
    const { port, lookup } = setup();
    lookup.hospitals.set('h1', { id: 'h1', name: 'AIIMS Delhi', isActive: true });
    lookup.primaryDoctor.set('p1', 'd1');
    // no affiliation added
    expect(await port.resolveForEngagement('p1', 'h1')).toBeNull();
  });

  it('rejects an inactive hospital even with an affiliation', async () => {
    const { port, lookup } = setup();
    lookup.hospitals.set('h1', { id: 'h1', name: 'Old Clinic', isActive: false });
    lookup.primaryDoctor.set('p1', 'd1');
    lookup.activeAffiliations.add('d1:h1');
    expect(await port.resolveForEngagement('p1', 'h1')).toBeNull();
  });

  it('rejects when the patient has no primary doctor', async () => {
    const { port, lookup } = setup();
    lookup.hospitals.set('h1', { id: 'h1', name: 'AIIMS Delhi', isActive: true });
    lookup.activeAffiliations.add('d1:h1');
    // no primaryDoctor mapping for p1
    expect(await port.resolveForEngagement('p1', 'h1')).toBeNull();
  });

  it('rejects a non-existent hospital id', async () => {
    const { port } = setup();
    expect(await port.resolveForEngagement('p1', 'does-not-exist')).toBeNull();
  });

  it('Virtual Hospital uses the well-known UUID', () => {
    expect(VIRTUAL_HOSPITAL_ID).toBe('00000000-0000-0000-0000-000000000000');
  });
});
