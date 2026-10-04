/**
 * In-memory fakes for the followup ports. No real IO. The FakeDb honors the
 * same RLS visibility + draft-only-edit rules the V5 policies enforce in
 * PostgreSQL, so unit tests can assert cross-patient denial and draft
 * immutability without a database.
 */
import type { FollowupDeps } from '../deps';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/ids';
import type { HospitalPort, HospitalRef } from '../ports/hospital';
import type { Logger } from '../logger';
import type {
  DbPort,
  FollowupRepository,
  FollowupRowRecord,
  FollowupRowUpdateInput,
  NewFollowupRowInput,
  SessionContext,
} from '../ports/db';

export class FakeIds implements IdGenerator {
  private n = 0;
  uuid(): string {
    this.n += 1;
    return `row-uuid-${this.n}`;
  }
}

export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  set(next: Date): void {
    this.current = next;
  }
}

export const noopLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/** A hospital port that accepts a fixed allowlist of hospital ids. */
export class FakeHospital implements HospitalPort {
  constructor(private known: Map<string, string> = new Map([['hosp-1', 'Test Hospital']])) {}
  add(id: string, name: string): void {
    this.known.set(id, name);
  }
  async resolveForEngagement(id: string): Promise<HospitalRef | null> {
    const name = this.known.get(id);
    return name ? { id, name } : null;
  }
}

/**
 * In-memory follow-up repository enforcing V5 RLS semantics against the last-set
 * session context:
 *   - patient/caregiver: only rows with patient_id === ctx.patientId visible;
 *     UPDATE allowed only while status === 'draft'.
 *   - admin: all rows visible.
 *   - doctor: no rows (policy deferred to Phase 6).
 */
export class FakeDb implements DbPort, FollowupRepository {
  public rows = new Map<string, FollowupRowRecord>();
  public contexts: SessionContext[] = [];
  private ctx: SessionContext | null = null;

  constructor(private clock: Clock) {}

  async transaction<T>(fn: (repo: FollowupRepository) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async setSessionContext(ctx: SessionContext): Promise<void> {
    this.ctx = ctx;
    this.contexts.push(ctx);
  }

  private canSee(row: FollowupRowRecord): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    if (ctx.role === 'admin') return true;
    if (ctx.role === 'patient' || ctx.role === 'caregiver') {
      return !!ctx.patientId && row.patientId === ctx.patientId;
    }
    return false;
  }

  async createRow(input: NewFollowupRowInput): Promise<FollowupRowRecord> {
    const now = this.clock.now().toISOString();
    const record: FollowupRowRecord = {
      id: input.id,
      patientId: input.patientId,
      ppDate: input.ppDate,
      status: 'draft',
      labValues: input.labValues,
      drugLevels: input.drugLevels,
      patientReportedDoses: input.patientReportedDoses,
      doctorPrescribedDoses: null,
      weightKg: input.weightKg,
      notes: input.notes,
      engagementHospitalId: input.engagementHospitalId,
      engagementHospitalName: input.engagementHospitalName,
      submittedAt: null,
      reviewedAt: null,
      reviewedBy: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(record.id, record);
    return { ...record };
  }

  async findRowById(id: string): Promise<FollowupRowRecord | null> {
    const row = this.rows.get(id);
    if (!row || !this.canSee(row)) return null;
    return { ...row };
  }

  async existsForDate(patientId: string, ppDate: string): Promise<boolean> {
    for (const row of this.rows.values()) {
      if (row.patientId === patientId && row.ppDate === ppDate) return true;
    }
    return false;
  }

  async updateRow(id: string, input: FollowupRowUpdateInput): Promise<FollowupRowRecord | null> {
    const row = this.rows.get(id);
    // RLS: visible AND draft-only for patient/caregiver.
    if (!row || !this.canSee(row)) return null;
    if (
      (this.ctx?.role === 'patient' || this.ctx?.role === 'caregiver') &&
      row.status !== 'draft'
    ) {
      return null;
    }
    const updated: FollowupRowRecord = {
      ...row,
      ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
      updatedAt: this.clock.now().toISOString(),
    } as FollowupRowRecord;
    this.rows.set(id, updated);
    return { ...updated };
  }

  async submitRow(id: string, submittedAt: string): Promise<FollowupRowRecord | null> {
    const row = this.rows.get(id);
    if (!row || !this.canSee(row)) return null;
    const updated: FollowupRowRecord = {
      ...row,
      status: 'pending',
      submittedAt,
      updatedAt: this.clock.now().toISOString(),
    };
    this.rows.set(id, updated);
    return { ...updated };
  }

  async listRowsForPatient(patientId: string): Promise<FollowupRowRecord[]> {
    return [...this.rows.values()]
      .filter((r) => r.patientId === patientId && this.canSee(r))
      .sort((a, b) => (a.ppDate < b.ppDate ? 1 : -1))
      .map((r) => ({ ...r }));
  }
}

export interface FakeBundle {
  deps: FollowupDeps;
  db: FakeDb;
  hospital: FakeHospital;
  ids: FakeIds;
  clock: FixedClock;
}

export function makeBundle(now?: Date): FakeBundle {
  const clock = new FixedClock(now ?? new Date('2026-01-01T00:00:00.000Z'));
  const ids = new FakeIds();
  const db = new FakeDb(clock);
  const hospital = new FakeHospital();
  const deps: FollowupDeps = { db, hospital, clock, ids, logger: noopLogger };
  return { deps, db, hospital, ids, clock };
}
