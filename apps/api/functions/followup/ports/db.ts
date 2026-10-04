/**
 * Database port for the followup domain (WP 2.2 — spec §7.2.1).
 *
 * Design notes (conventions.md):
 * - Parameterized queries only in the concrete adapter; no interpolation.
 * - RLS enforced: `setSessionContext` sets the transaction-local session vars
 *   the V5 follow_up_rows policies read. follow_up_rows has FORCE ROW LEVEL
 *   SECURITY, so a cross-patient read/write returns nothing even if a handler
 *   is buggy.
 * - The concrete adapter (RDS Proxy + node-postgres) lives behind this port and
 *   is faked in unit tests — no real DB in tests.
 */
import type { LabValues, DrugLevels, DoseValues } from '../field-catalog';

export type UserRole = 'patient' | 'caregiver' | 'doctor' | 'admin';
export type FollowupStatus = 'draft' | 'pending' | 'reviewed';

/** Session context applied to a connection before row-scoped queries run. */
export interface SessionContext {
  userId: string;
  role: UserRole;
  patientId?: string | null;
}

/** A follow-up row record. JSONB groups map to the §7.2.1 field catalog. */
export interface FollowupRowRecord {
  id: string;
  patientId: string;
  ppDate: string; // ISO date (YYYY-MM-DD)
  status: FollowupStatus;
  labValues: LabValues;
  drugLevels: DrugLevels;
  patientReportedDoses: DoseValues;
  doctorPrescribedDoses: DoseValues | null;
  weightKg: number | null;
  notes: string | null;
  engagementHospitalId: string;
  engagementHospitalName: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields accepted when creating a draft row. Server sets id/status/timestamps. */
export interface NewFollowupRowInput {
  id: string;
  patientId: string;
  ppDate: string;
  labValues: LabValues;
  drugLevels: DrugLevels;
  patientReportedDoses: DoseValues;
  weightKg: number | null;
  notes: string | null;
  engagementHospitalId: string;
  engagementHospitalName: string;
}

/** Mutable fields on a draft row (patient edit). Only provided keys change. */
export interface FollowupRowUpdateInput {
  ppDate?: string;
  labValues?: LabValues;
  drugLevels?: DrugLevels;
  patientReportedDoses?: DoseValues;
  weightKg?: number | null;
  notes?: string | null;
  engagementHospitalId?: string;
  engagementHospitalName?: string;
}

/**
 * Transaction-scoped repository. All methods run under the RLS context set via
 * `setSessionContext` and use parameterized queries.
 */
export interface FollowupRepository {
  setSessionContext(ctx: SessionContext): Promise<void>;

  /** Create a draft row. Throws on (patient_id, pp_date) uniqueness conflict. */
  createRow(input: NewFollowupRowInput): Promise<FollowupRowRecord>;

  /** Read one row by id (RLS-scoped). Null if not visible. */
  findRowById(id: string): Promise<FollowupRowRecord | null>;

  /** True if a row already exists for (patientId, ppDate). */
  existsForDate(patientId: string, ppDate: string): Promise<boolean>;

  /** Update a draft row's mutable fields. Null if not visible/updatable. */
  updateRow(id: string, input: FollowupRowUpdateInput): Promise<FollowupRowRecord | null>;

  /**
   * Transition a draft row to 'pending' and stamp submitted_at. Returns the
   * updated row, or null if not visible. Throws if the row is not a draft.
   */
  submitRow(id: string, submittedAt: string): Promise<FollowupRowRecord | null>;

  /** List rows for a patient (RLS-scoped), newest pp_date first. */
  listRowsForPatient(patientId: string): Promise<FollowupRowRecord[]>;
}

/** DB port entrypoint: run work inside a single transaction. */
export interface DbPort {
  transaction<T>(fn: (repo: FollowupRepository) => Promise<T>): Promise<T>;
}
