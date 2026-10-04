/**
 * In-memory fakes for the admin ports. No real IO. The FakeDb models the V8
 * schema constraints the service relies on (unique hospital_code, one-primary-
 * per-doctor, user roles) and keeps a follow_up_rows snapshot so a test can
 * prove deactivation does not mutate historical engagement rows (DoD).
 */
import type { AdminDeps, AdminConfig, Clock, IdGenerator } from '../deps';
import type { Logger } from '../logger';
import type {
  AdminRepository,
  AffiliationRecord,
  AffiliationUpdateInput,
  DbPort,
  HospitalRecord,
  HospitalSearchQuery,
  HospitalStatus,
  HospitalUpdateInput,
  NewAffiliationInput,
  NewHospitalInput,
  SessionContext,
  UserRole,
} from '../ports/db';

export class FakeIds implements IdGenerator {
  private n = 0;
  uuid(): string {
    this.n += 1;
    return `id-${this.n}`;
  }
}

export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
}

export const noopLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

const VIRTUAL_ID = '00000000-0000-0000-0000-000000000000';

export class FakeDb implements DbPort, AdminRepository {
  public hospitals = new Map<string, HospitalRecord>();
  public affiliations = new Map<string, AffiliationRecord>();
  public users = new Map<string, UserRole>();
  /** A frozen snapshot of a follow_up_rows engagement, to assert DoD. */
  public followUpSnapshots: { rowId: string; engagementHospitalId: string }[] = [];

  constructor(private clock: Clock) {
    // Seed the Virtual Hospital + system admin like V8 does.
    this.hospitals.set(VIRTUAL_ID, {
      id: VIRTUAL_ID,
      hospitalCode: 'VIRTUAL',
      hospitalName: 'Virtual / Remote Consultation',
      hospitalType: 'virtual',
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      country: null,
      postalCode: null,
      phone: null,
      websiteUrl: null,
      logoUrl: null,
      status: 'active',
      createdBy: '00000000-0000-0000-0000-000000000001',
      createdAt: this.clock.now().toISOString(),
      updatedAt: this.clock.now().toISOString(),
    });
  }

  async transaction<T>(fn: (repo: AdminRepository) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async setSessionContext(_ctx: SessionContext): Promise<void> {
    /* no-op in the fake */
  }

  // ── Hospitals ────────────────────────────────────────────────────────────
  async getHospitalById(id: string): Promise<HospitalRecord | null> {
    return this.hospitals.get(id) ?? null;
  }
  async getHospitalByCode(code: string): Promise<HospitalRecord | null> {
    for (const h of this.hospitals.values()) {
      if (h.hospitalCode.toUpperCase() === code.toUpperCase()) return h;
    }
    return null;
  }
  async createHospital(input: NewHospitalInput): Promise<HospitalRecord> {
    const now = this.clock.now().toISOString();
    const rec: HospitalRecord = {
      id: input.id,
      hospitalCode: input.hospitalCode,
      hospitalName: input.hospitalName,
      hospitalType: input.hospitalType,
      addressLine1: input.addressLine1 ?? null,
      addressLine2: input.addressLine2 ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      country: input.country ?? null,
      postalCode: input.postalCode ?? null,
      phone: input.phone ?? null,
      websiteUrl: input.websiteUrl ?? null,
      logoUrl: input.logoUrl ?? null,
      status: 'active',
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    this.hospitals.set(rec.id, rec);
    return { ...rec };
  }
  async updateHospital(id: string, input: HospitalUpdateInput): Promise<HospitalRecord | null> {
    const h = this.hospitals.get(id);
    if (!h) return null;
    const updated: HospitalRecord = {
      ...h,
      ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
      updatedAt: this.clock.now().toISOString(),
    } as HospitalRecord;
    this.hospitals.set(id, updated);
    return { ...updated };
  }
  async setHospitalStatus(id: string, status: HospitalStatus): Promise<HospitalRecord | null> {
    const h = this.hospitals.get(id);
    if (!h) return null;
    h.status = status;
    h.updatedAt = this.clock.now().toISOString();
    return { ...h };
  }
  async searchHospitals(q: HospitalSearchQuery): Promise<HospitalRecord[]> {
    let list = [...this.hospitals.values()];
    if (q.search) {
      const s = q.search.toLowerCase();
      list = list.filter(
        (h) =>
          h.hospitalName.toLowerCase().includes(s) ||
          h.hospitalCode.toLowerCase().includes(s) ||
          (h.city ?? '').toLowerCase().includes(s)
      );
    }
    if (q.type) list = list.filter((h) => h.hospitalType === q.type);
    if (q.status) list = list.filter((h) => h.status === q.status);
    list.sort((a, b) => (a.hospitalName < b.hospitalName ? -1 : 1));
    return list.slice(q.offset, q.offset + q.limit).map((h) => ({ ...h }));
  }

  // ── Affiliations ─────────────────────────────────────────────────────────
  async getUserRole(userId: string): Promise<UserRole | null> {
    return this.users.get(userId) ?? null;
  }
  async findAffiliation(doctorId: string, hospitalId: string): Promise<AffiliationRecord | null> {
    for (const a of this.affiliations.values()) {
      if (a.doctorId === doctorId && a.hospitalId === hospitalId) return { ...a };
    }
    return null;
  }
  async getAffiliationById(id: string): Promise<AffiliationRecord | null> {
    const a = this.affiliations.get(id);
    return a ? { ...a } : null;
  }
  async hasPrimaryAffiliation(doctorId: string): Promise<boolean> {
    for (const a of this.affiliations.values()) {
      if (a.doctorId === doctorId && a.isPrimary) return true;
    }
    return false;
  }
  async addAffiliation(input: NewAffiliationInput): Promise<AffiliationRecord> {
    const rec: AffiliationRecord = {
      id: input.id,
      doctorId: input.doctorId,
      hospitalId: input.hospitalId,
      roleAtHospital: input.roleAtHospital,
      isPrimary: input.isPrimary,
      status: 'active',
      grantedBy: input.grantedBy,
      grantedAt: this.clock.now().toISOString(),
    };
    this.affiliations.set(rec.id, rec);
    return { ...rec };
  }
  async updateAffiliation(
    id: string,
    input: AffiliationUpdateInput
  ): Promise<AffiliationRecord | null> {
    const a = this.affiliations.get(id);
    if (!a) return null;
    const updated: AffiliationRecord = {
      ...a,
      ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
    } as AffiliationRecord;
    this.affiliations.set(id, updated);
    return { ...updated };
  }
}

const CONFIG: AdminConfig = { defaultPageSize: 25, maxPageSize: 100 };

export interface FakeBundle {
  deps: AdminDeps;
  db: FakeDb;
  ids: FakeIds;
  clock: FixedClock;
}

export function makeBundle(now?: Date): FakeBundle {
  const clock = new FixedClock(now ?? new Date('2026-01-01T00:00:00.000Z'));
  const ids = new FakeIds();
  const db = new FakeDb(clock);
  const deps: AdminDeps = { db, clock, ids, logger: noopLogger, config: { ...CONFIG } };
  return { deps, db, ids, clock };
}
