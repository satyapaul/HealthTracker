/**
 * In-memory fakes for the hospital (read/picker) ports. No real IO. The FakeDb
 * seeds the Virtual Hospital, hospitals, affiliations, patient->primaryDoctor,
 * and doctor-patient assignments so the picker scopes + access checks can be
 * exercised without a database.
 */
import type { HospitalDeps, HospitalConfig, PickerEntry } from '../deps';
import type { PickerCache } from '../ports/cache';
import type { Logger } from '../logger';
import type {
  AffiliationView,
  DbPort,
  HospitalRepository,
  HospitalSummary,
  SessionContext,
} from '../ports/db';

export const noopLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

export const VIRTUAL_ID = '00000000-0000-0000-0000-000000000000';

function virtualSummary(): HospitalSummary {
  return {
    id: VIRTUAL_ID,
    hospitalCode: 'VIRTUAL',
    hospitalName: 'Virtual / Remote Consultation',
    hospitalType: 'virtual',
    city: null,
    logoUrl: null,
    status: 'active',
  };
}

export class FakeDb implements DbPort, HospitalRepository {
  public hospitals = new Map<string, HospitalSummary>();
  /** doctorId -> hospitalIds with an ACTIVE affiliation. */
  public affiliations = new Map<string, Set<string>>();
  /** Full affiliation views for H-05, keyed by doctorId. */
  public affiliationViews = new Map<string, AffiliationView[]>();
  public primaryDoctor = new Map<string, string>(); // patientId -> doctorId
  public assignments = new Set<string>(); // `${doctorId}:${patientId}`

  constructor() {
    this.hospitals.set(VIRTUAL_ID, virtualSummary());
  }

  addHospital(h: HospitalSummary): void {
    this.hospitals.set(h.id, h);
  }
  affiliate(doctorId: string, hospitalId: string): void {
    if (!this.affiliations.has(doctorId)) this.affiliations.set(doctorId, new Set());
    this.affiliations.get(doctorId)!.add(hospitalId);
  }
  assign(doctorId: string, patientId: string): void {
    this.assignments.add(`${doctorId}:${patientId}`);
  }

  async transaction<T>(fn: (repo: HospitalRepository) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async setSessionContext(_ctx: SessionContext): Promise<void> {
    /* no-op */
  }

  async getVirtualHospital(): Promise<HospitalSummary | null> {
    return this.hospitals.get(VIRTUAL_ID) ?? null;
  }
  async getHospitalById(id: string): Promise<HospitalSummary | null> {
    return this.hospitals.get(id) ?? null;
  }
  async listActiveAffiliatedHospitals(doctorId: string): Promise<HospitalSummary[]> {
    const ids = this.affiliations.get(doctorId) ?? new Set<string>();
    return [...ids]
      .map((id) => this.hospitals.get(id))
      .filter((h): h is HospitalSummary => !!h && h.status === 'active' && h.id !== VIRTUAL_ID)
      .sort((a, b) => (a.hospitalName < b.hospitalName ? -1 : 1));
  }
  async getPrimaryDoctorId(patientId: string): Promise<string | null> {
    return this.primaryDoctor.get(patientId) ?? null;
  }
  async isDoctorAssignedToPatient(doctorId: string, patientId: string): Promise<boolean> {
    return this.assignments.has(`${doctorId}:${patientId}`);
  }
  async listDoctorAffiliations(doctorId: string): Promise<AffiliationView[]> {
    return this.affiliationViews.get(doctorId) ?? [];
  }
}

/** A pass-through cache that records whether it was hit (defaults to miss). */
export class FakeCache implements PickerCache<PickerEntry[]> {
  public store = new Map<string, PickerEntry[]>();
  async get(key: string): Promise<PickerEntry[] | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: PickerEntry[]): Promise<void> {
    this.store.set(key, value);
  }
}

const CONFIG: HospitalConfig = { pickerCacheTtlSeconds: 300 };

export interface FakeBundle {
  deps: HospitalDeps;
  db: FakeDb;
  cache: FakeCache;
}

export function makeBundle(): FakeBundle {
  const db = new FakeDb();
  const cache = new FakeCache();
  const deps: HospitalDeps = { db, pickerCache: cache, logger: noopLogger, config: { ...CONFIG } };
  return { deps, db, cache };
}
