/**
 * In-memory fakes for the patient ports. No real IO. The FakeDb honors the same
 * RLS visibility rules the V4 policies enforce in PostgreSQL, so unit tests can
 * assert cross-patient access is denied without a database.
 */
import type { PatientDeps } from '../deps';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/ids';
import type { Logger } from '../logger';
import type {
  DbPort,
  NewPatientInput,
  PatientRecord,
  PatientRepository,
  PatientUpdateInput,
  ReminderPreferences,
  SessionContext,
} from '../ports/db';

export class FakeIds implements IdGenerator {
  private n = 0;
  uuid(): string {
    this.n += 1;
    return `patient-uuid-${this.n}`;
  }
}

export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
}

export const noopLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

const DEFAULT_PREFS: ReminderPreferences = {
  smsEnabled: true,
  whatsappEnabled: true,
  timezone: 'Asia/Kolkata',
};

/**
 * In-memory patient repository that enforces the V4 RLS semantics against the
 * last-set session context:
 *   - patient/caregiver: only the row whose id === ctx.patientId is visible.
 *   - admin: all rows visible.
 *   - doctor: NO rows visible (care-team policy deferred to Phase 6).
 */
export class FakeDb implements DbPort, PatientRepository {
  public rows = new Map<string, PatientRecord>();
  public contexts: SessionContext[] = [];
  private ctx: SessionContext | null = null;

  constructor(private clock: Clock) {}

  async transaction<T>(fn: (repo: PatientRepository) => Promise<T>): Promise<T> {
    // Context is set per-transaction by the caller via setSessionContext.
    return fn(this);
  }

  async setSessionContext(ctx: SessionContext): Promise<void> {
    this.ctx = ctx;
    this.contexts.push(ctx);
  }

  /** Mirror RLS: can the current context see this row? */
  private canSee(row: PatientRecord): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    if (ctx.role === 'admin') return true;
    if (ctx.role === 'patient' || ctx.role === 'caregiver') {
      return !!ctx.patientId && row.id === ctx.patientId;
    }
    // doctor: denied (no policy yet)
    return false;
  }

  async createPatient(input: NewPatientInput): Promise<PatientRecord> {
    const now = this.clock.now().toISOString();
    const record: PatientRecord = {
      id: input.id,
      name: input.name,
      ageYears: input.ageYears ?? null,
      sex: input.sex ?? null,
      maxId: input.maxId,
      photoUrl: input.photoUrl ?? null,
      dateOfOperation: input.dateOfOperation ?? null,
      diagnosis: input.diagnosis ?? null,
      histopathology: input.histopathology ?? null,
      anastomosisType: input.anastomosisType ?? null,
      contactEmail: input.contactEmail ?? null,
      phoneNumber: input.phoneNumber ?? null,
      whatsappNumber: input.whatsappNumber ?? null,
      reminderPreferences: input.reminderPreferences ?? DEFAULT_PREFS,
      reminderOptOut: input.reminderOptOut ?? false,
      procedureHospitalId: input.procedureHospitalId ?? null,
      defaultFollowupHospitalId: input.defaultFollowupHospitalId ?? null,
      primaryDoctorId: input.primaryDoctorId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(record.id, record);
    return { ...record };
  }

  async findPatientById(id: string): Promise<PatientRecord | null> {
    const row = this.rows.get(id);
    if (!row || !this.canSee(row)) return null;
    return { ...row };
  }

  async existsByMaxId(maxId: string): Promise<boolean> {
    for (const row of this.rows.values()) {
      if (row.maxId === maxId) return true;
    }
    return false;
  }

  async updatePatient(id: string, input: PatientUpdateInput): Promise<PatientRecord | null> {
    const row = this.rows.get(id);
    if (!row || !this.canSee(row)) return null;
    const updated: PatientRecord = {
      ...row,
      ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
      updatedAt: this.clock.now().toISOString(),
    } as PatientRecord;
    this.rows.set(id, updated);
    return { ...updated };
  }

  async listPatients(): Promise<PatientRecord[]> {
    return [...this.rows.values()].filter((r) => this.canSee(r)).map((r) => ({ ...r }));
  }
}

export interface FakeBundle {
  deps: PatientDeps;
  db: FakeDb;
  ids: FakeIds;
  clock: FixedClock;
}

export function makeBundle(now?: Date): FakeBundle {
  const clock = new FixedClock(now ?? new Date('2026-01-01T00:00:00.000Z'));
  const ids = new FakeIds();
  const db = new FakeDb(clock);
  const deps: PatientDeps = { db, clock, ids, logger: noopLogger };
  return { deps, db, ids, clock };
}
