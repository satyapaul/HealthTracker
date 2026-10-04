/**
 * Database port for the dose (doctor review) domain (WP 2.3 — spec §7.2/§7.4).
 *
 * Design notes (conventions.md):
 * - Parameterized queries only; no interpolation.
 * - RLS enforced via `setSessionContext`. The V6 doctor policies gate every
 *   operation on doctor_patient_assignments, so an unassigned doctor sees/
 *   writes nothing even if a handler is buggy.
 * - dose_changes and doctor_responses are APPEND-ONLY: the port exposes insert
 *   + read, never update/delete (the DB grant also withholds UPDATE/DELETE).
 * - The whole review is one transaction (diff -> insert dose_changes ->
 *   update row -> insert response), so a partial review never persists.
 */
import type { DoseValues } from '../doses';

export type UserRole = 'patient' | 'caregiver' | 'doctor' | 'admin';
export type FollowupStatus = 'draft' | 'pending' | 'reviewed';

export interface SessionContext {
  userId: string;
  role: UserRole;
  patientId?: string | null;
}

/** Minimal follow-up row projection the review flow needs. */
export interface FollowupRowForReview {
  id: string;
  patientId: string;
  status: FollowupStatus;
  patientReportedDoses: DoseValues;
  doctorPrescribedDoses: DoseValues | null;
}

export interface DoseChangeRecord {
  id: string;
  followUpRowId: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string;
  changedBy: string;
  changedAt: string;
  reason: string | null;
}

export interface DoctorResponseRecord {
  id: string;
  followUpRowId: string;
  doctorId: string;
  additionalTests: unknown[];
  additionalMedications: string | null;
  clinicalNotes: string | null;
  nextFollowupIntervalDays: number | null;
  sentAt: string;
}

export interface NewDoseChangeInput {
  id: string;
  followUpRowId: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string;
  changedBy: string;
  changedAt: string;
  reason: string | null;
}

export interface NewDoctorResponseInput {
  id: string;
  followUpRowId: string;
  doctorId: string;
  additionalTests: unknown[];
  additionalMedications: string | null;
  clinicalNotes: string | null;
  nextFollowupIntervalDays: number | null;
  sentAt: string;
}

/**
 * Transaction-scoped repository for the review flow. All methods run under the
 * RLS context set via `setSessionContext`.
 */
export interface DoseRepository {
  setSessionContext(ctx: SessionContext): Promise<void>;

  /** Load the row under review (RLS-scoped). Null if not visible. */
  findRowForReview(id: string): Promise<FollowupRowForReview | null>;

  /** True if a doctor_response already exists for this row (UNIQUE guard). */
  responseExists(followUpRowId: string): Promise<boolean>;

  /** Append a dose-change audit row. */
  insertDoseChange(input: NewDoseChangeInput): Promise<DoseChangeRecord>;

  /**
   * Mark the row reviewed: set doctor_prescribed_doses, status='reviewed',
   * reviewed_at, reviewed_by. Returns the new status/timestamps echo.
   */
  markReviewed(
    id: string,
    doctorPrescribedDoses: DoseValues,
    reviewedBy: string,
    reviewedAt: string
  ): Promise<void>;

  /** Append the doctor_response (one per row). */
  insertResponse(input: NewDoctorResponseInput): Promise<DoctorResponseRecord>;

  /** Read the dose-change history for a row (RLS-scoped), oldest first. */
  listDoseChanges(followUpRowId: string): Promise<DoseChangeRecord[]>;

  /** Read the doctor_response for a row (RLS-scoped). Null if none/not visible. */
  findResponse(followUpRowId: string): Promise<DoctorResponseRecord | null>;
}

/** DB port entrypoint: run work inside a single transaction. */
export interface DbPort {
  transaction<T>(fn: (repo: DoseRepository) => Promise<T>): Promise<T>;
}
