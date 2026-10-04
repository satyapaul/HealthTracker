/**
 * In-memory fakes for the dose (review) ports. No real IO. The FakeDb honors
 * the V6 RLS semantics (doctor gated on doctor_patient_assignments; patient on
 * own rows) and the append-only nature of dose_changes / doctor_responses, so
 * unit tests can assert gating + immutability without a database.
 */
import type { DoseDeps } from '../deps';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/ids';
import type { SystemCardPoster } from '../ports/system-card';
import type { Logger } from '../logger';
import type {
  DbPort,
  DoctorResponseRecord,
  DoseChangeRecord,
  DoseRepository,
  FollowupRowForReview,
  NewDoctorResponseInput,
  NewDoseChangeInput,
  SessionContext,
} from '../ports/db';
import type { DoseValues } from '../doses';

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

/** A follow-up row seeded into the fake store. */
export interface SeedRow {
  id: string;
  patientId: string;
  status: 'draft' | 'pending' | 'reviewed';
  patientReportedDoses: DoseValues;
  doctorPrescribedDoses?: DoseValues | null;
}

/**
 * In-memory dose repository enforcing V6 RLS against the last-set context:
 *   - doctor: a row/record is visible only if the doctor is assigned to that
 *     row's patient (assignments map).
 *   - patient/caregiver: own patient's rows only.
 *   - admin: all.
 * dose_changes / doctor_responses are append-only (no update/delete methods).
 */
export class FakeDb implements DbPort, DoseRepository {
  public rows = new Map<string, FollowupRowForReview>();
  /** doctorId -> set of patientIds (doctor_patient_assignments). */
  public assignments = new Map<string, Set<string>>();
  public doseChanges: DoseChangeRecord[] = [];
  public responses = new Map<string, DoctorResponseRecord>();
  public reviewedUpdates: {
    id: string;
    doses: DoseValues;
    reviewedBy: string;
    reviewedAt: string;
  }[] = [];
  private ctx: SessionContext | null = null;

  seedRow(r: SeedRow): void {
    this.rows.set(r.id, {
      id: r.id,
      patientId: r.patientId,
      status: r.status,
      patientReportedDoses: r.patientReportedDoses,
      doctorPrescribedDoses: r.doctorPrescribedDoses ?? null,
    });
  }

  assign(doctorId: string, patientId: string): void {
    if (!this.assignments.has(doctorId)) this.assignments.set(doctorId, new Set());
    this.assignments.get(doctorId)!.add(patientId);
  }

  async transaction<T>(fn: (repo: DoseRepository) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async setSessionContext(ctx: SessionContext): Promise<void> {
    this.ctx = ctx;
  }

  private canSeeRow(row: FollowupRowForReview): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    if (ctx.role === 'admin') return true;
    if (ctx.role === 'patient' || ctx.role === 'caregiver') {
      return !!ctx.patientId && row.patientId === ctx.patientId;
    }
    if (ctx.role === 'doctor') {
      return this.assignments.get(ctx.userId)?.has(row.patientId) ?? false;
    }
    return false;
  }

  async findRowForReview(id: string): Promise<FollowupRowForReview | null> {
    const row = this.rows.get(id);
    if (!row || !this.canSeeRow(row)) return null;
    return { ...row, patientReportedDoses: { ...row.patientReportedDoses } };
  }

  async responseExists(followUpRowId: string): Promise<boolean> {
    return this.responses.has(followUpRowId);
  }

  async insertDoseChange(input: NewDoseChangeInput): Promise<DoseChangeRecord> {
    const rec: DoseChangeRecord = { ...input };
    this.doseChanges.push(rec);
    return { ...rec };
  }

  async markReviewed(
    id: string,
    doctorPrescribedDoses: DoseValues,
    reviewedBy: string,
    reviewedAt: string
  ): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      row.status = 'reviewed';
      row.doctorPrescribedDoses = { ...doctorPrescribedDoses };
    }
    this.reviewedUpdates.push({ id, doses: doctorPrescribedDoses, reviewedBy, reviewedAt });
  }

  async insertResponse(input: NewDoctorResponseInput): Promise<DoctorResponseRecord> {
    const rec: DoctorResponseRecord = { ...input };
    this.responses.set(input.followUpRowId, rec);
    return { ...rec };
  }

  async listDoseChanges(followUpRowId: string): Promise<DoseChangeRecord[]> {
    const row = this.rows.get(followUpRowId);
    if (!row || !this.canSeeRow(row)) return [];
    return this.doseChanges
      .filter((d) => d.followUpRowId === followUpRowId)
      .sort((a, b) => (a.changedAt < b.changedAt ? -1 : 1))
      .map((d) => ({ ...d }));
  }

  async findResponse(followUpRowId: string): Promise<DoctorResponseRecord | null> {
    const row = this.rows.get(followUpRowId);
    if (!row || !this.canSeeRow(row)) return null;
    const r = this.responses.get(followUpRowId);
    return r ? { ...r } : null;
  }
}

/** Fake system-card poster — records DoseChanged cards (WP 5.2). */
export class FakeSystemCardPoster implements SystemCardPoster {
  public cards: {
    patientId: string;
    followUpRowId: string;
    changes: { fieldName: string; newValue: string }[];
  }[] = [];
  async postDoseChanges(input: {
    patientId: string;
    followUpRowId: string;
    changes: { fieldName: string; newValue: string }[];
  }): Promise<void> {
    this.cards.push(input);
  }
}

export interface FakeBundle {
  deps: DoseDeps;
  db: FakeDb;
  systemCards: FakeSystemCardPoster;
  ids: FakeIds;
  clock: FixedClock;
}

export function makeBundle(now?: Date): FakeBundle {
  const clock = new FixedClock(now ?? new Date('2026-06-10T10:00:00.000Z'));
  const ids = new FakeIds();
  const db = new FakeDb();
  const systemCards = new FakeSystemCardPoster();
  const deps: DoseDeps = { db, systemCards, clock, ids, logger: noopLogger };
  return { deps, db, systemCards, ids, clock };
}
