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
import type { S3Port, UploadIntentCache, UploadIntent, PresignedUpload } from '../ports/storage';
import type { ReminderCanceller, ReminderCancellation } from '../ports/reminders';
import type { FollowupConfig } from '../deps';
import type { Logger } from '../logger';
import type {
  AttachmentRecord,
  AttachmentRepository,
  DbPort,
  FollowupRepository,
  FollowupRowRecord,
  FollowupRowUpdateInput,
  NewAttachmentInput,
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

/**
 * A simple allowlist HospitalPort for followup/attachment tests that only need
 * "this hospital id is valid for the engagement". The real Virtual-or-
 * affiliation RULE (DbHospitalPort) is exercised in hospital.test.ts.
 */
export class FakeHospital implements HospitalPort {
  constructor(private known: Map<string, string> = new Map([['hosp-1', 'Test Hospital']])) {}
  add(id: string, name: string): void {
    this.known.set(id, name);
  }
  async resolveForEngagement(_patientId: string, id: string): Promise<HospitalRef | null> {
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
export class FakeDb implements DbPort, FollowupRepository, AttachmentRepository {
  public rows = new Map<string, FollowupRowRecord>();
  public attachments: AttachmentRecord[] = [];
  public contexts: SessionContext[] = [];
  private ctx: SessionContext | null = null;

  constructor(private clock: Clock) {}

  async transaction<T>(
    fn: (repo: FollowupRepository & AttachmentRepository) => Promise<T>
  ): Promise<T> {
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

  // ── AttachmentRepository (WP 2.4) ──────────────────────────────────────────
  async insertAttachment(input: NewAttachmentInput): Promise<AttachmentRecord> {
    const rec: AttachmentRecord = {
      id: input.id,
      followUpRowId: input.followUpRowId,
      objectKey: input.objectKey,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      fileSizeBytes: input.fileSizeBytes,
      scanStatus: 'pending',
      uploadedBy: input.uploadedBy,
      createdAt: this.clock.now().toISOString(),
    };
    this.attachments.push(rec);
    return { ...rec };
  }

  async listAttachments(followUpRowId: string): Promise<AttachmentRecord[]> {
    // The row-visibility check happens in the service via findRowById; here we
    // just return this row's attachments newest-first.
    return this.attachments
      .filter((a) => a.followUpRowId === followUpRowId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((a) => ({ ...a }));
  }
}

/** Fake S3 port: records presign calls and tracks which objects "exist". */
export class FakeS3 implements S3Port {
  public existing = new Set<string>();
  public presigned: { objectKey: string; contentType: string; maxBytes: number }[] = [];

  async presignPut(
    objectKey: string,
    contentType: string,
    maxBytes: number
  ): Promise<PresignedUpload> {
    this.presigned.push({ objectKey, contentType, maxBytes });
    return {
      uploadUrl: `https://s3.test/${objectKey}?sig=fake`,
      expiresAt: '2026-01-01T00:15:00.000Z',
    };
  }

  /** Simulate the client having completed the PUT. */
  markUploaded(objectKey: string): void {
    this.existing.add(objectKey);
  }

  async objectExists(objectKey: string): Promise<boolean> {
    return this.existing.has(objectKey);
  }
}

/** Fake upload-intent cache (in-memory, no TTL enforcement). */
export class FakeUploadIntentCache implements UploadIntentCache {
  public store = new Map<string, UploadIntent>();
  async put(objectKey: string, intent: UploadIntent): Promise<void> {
    this.store.set(objectKey, intent);
  }
  async get(objectKey: string): Promise<UploadIntent | null> {
    return this.store.get(objectKey) ?? null;
  }
  async del(objectKey: string): Promise<void> {
    this.store.delete(objectKey);
  }
}

export const defaultConfig: FollowupConfig = {
  allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
  maxUploadBytes: 20 * 1024 * 1024,
  uploadIntentTtlSeconds: 1800,
};

/**
 * Fake reminder canceller (WP 4.2). Records each submit-cancellation call and
 * returns a configurable result so tests can assert cancel-on-submit.
 */
export class FakeReminderCanceller implements ReminderCanceller {
  public calls: { patientId: string; followUpRowId: string }[] = [];
  public result: ReminderCancellation = { milestoneId: null, cancelledCount: 0 };
  async cancelPendingForFollowup(
    patientId: string,
    followUpRowId: string
  ): Promise<ReminderCancellation> {
    this.calls.push({ patientId, followUpRowId });
    return this.result;
  }
}

export interface FakeBundle {
  deps: FollowupDeps;
  db: FakeDb;
  hospital: FakeHospital;
  s3: FakeS3;
  uploadIntents: FakeUploadIntentCache;
  reminders: FakeReminderCanceller;
  ids: FakeIds;
  clock: FixedClock;
}

export function makeBundle(now?: Date): FakeBundle {
  const clock = new FixedClock(now ?? new Date('2026-01-01T00:00:00.000Z'));
  const ids = new FakeIds();
  const db = new FakeDb(clock);
  const hospital = new FakeHospital();
  const s3 = new FakeS3();
  const uploadIntents = new FakeUploadIntentCache();
  const reminders = new FakeReminderCanceller();
  const deps: FollowupDeps = {
    db,
    hospital,
    s3,
    uploadIntents,
    reminders,
    clock,
    ids,
    logger: noopLogger,
    config: { ...defaultConfig },
  };
  return { deps, db, hospital, s3, uploadIntents, reminders, ids, clock };
}
