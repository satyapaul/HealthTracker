/**
 * Database port for the patient domain (WP 2.1 — spec §7.1).
 *
 * Design notes (conventions.md):
 * - No string-interpolated SQL: the concrete adapter uses parameterized queries
 *   only.
 * - RLS is enforced: `setSessionContext` sets the transaction-local session
 *   vars (app.current_user_id / app.current_role / app.current_patient_id) that
 *   the V4 patients policies read. The app connects as the least-privilege role
 *   and never bypasses RLS. The patients table has FORCE ROW LEVEL SECURITY, so
 *   a cross-patient read returns no row even if a handler is buggy.
 * - The concrete adapter (RDS Proxy + node-postgres) lives behind this port and
 *   is faked in unit tests — no real DB in tests.
 */

export type UserRole = 'patient' | 'caregiver' | 'doctor' | 'admin';

/** Session context applied to a connection before patient-scoped queries run. */
export interface SessionContext {
  userId: string;
  role: UserRole;
  /** null for doctor/admin; the linked patient id for patient/caregiver. */
  patientId?: string | null;
}

/** Reminder/notification preferences stored on the chart (spec §7.1 / LLD §1.7). */
export interface ReminderPreferences {
  smsEnabled: boolean;
  whatsappEnabled: boolean;
  timezone: string;
}

/**
 * A patient chart record (clinical header). Field keys are the canonical camelCase
 * mapping of the snake_case columns in V4 (LLD §1.7 + §1.25).
 */
export interface PatientRecord {
  id: string;
  name: string;
  ageYears: number | null;
  sex: 'M' | 'F' | 'O' | null;
  maxId: string;
  photoUrl: string | null;
  dateOfOperation: string | null; // ISO date (YYYY-MM-DD)
  diagnosis: string | null;
  histopathology: string | null;
  anastomosisType: string | null;
  contactEmail: string | null;
  phoneNumber: string | null;
  whatsappNumber: string | null;
  reminderPreferences: ReminderPreferences;
  reminderOptOut: boolean;
  procedureHospitalId: string | null;
  defaultFollowupHospitalId: string | null;
  primaryDoctorId: string | null;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

/** Fields accepted when creating a chart. Server sets id/timestamps. */
export interface NewPatientInput {
  id: string;
  name: string;
  ageYears?: number | null;
  sex?: 'M' | 'F' | 'O' | null;
  maxId: string;
  photoUrl?: string | null;
  dateOfOperation?: string | null;
  diagnosis?: string | null;
  histopathology?: string | null;
  anastomosisType?: string | null;
  contactEmail?: string | null;
  phoneNumber?: string | null;
  whatsappNumber?: string | null;
  reminderPreferences?: ReminderPreferences | null;
  reminderOptOut?: boolean | null;
  procedureHospitalId?: string | null;
  defaultFollowupHospitalId?: string | null;
  primaryDoctorId?: string | null;
}

/**
 * Mutable chart fields for an update. All optional; only provided keys change.
 * Identity/immutable server fields (id, maxId, timestamps) are not updatable
 * here — maxId is the stable hospital record number set at onboarding.
 */
export interface PatientUpdateInput {
  name?: string;
  ageYears?: number | null;
  sex?: 'M' | 'F' | 'O' | null;
  photoUrl?: string | null;
  dateOfOperation?: string | null;
  diagnosis?: string | null;
  histopathology?: string | null;
  anastomosisType?: string | null;
  contactEmail?: string | null;
  phoneNumber?: string | null;
  whatsappNumber?: string | null;
  reminderPreferences?: ReminderPreferences | null;
  reminderOptOut?: boolean | null;
  procedureHospitalId?: string | null;
  defaultFollowupHospitalId?: string | null;
  primaryDoctorId?: string | null;
}

/**
 * Transaction-scoped repository. All methods use parameterized queries and run
 * under the RLS context set via `setSessionContext`.
 */
export interface PatientRepository {
  setSessionContext(ctx: SessionContext): Promise<void>;

  /** Create a chart. Returns the persisted record. Throws on max_id conflict. */
  createPatient(input: NewPatientInput): Promise<PatientRecord>;

  /** Read one chart by id. RLS limits visibility; returns null if not visible. */
  findPatientById(id: string): Promise<PatientRecord | null>;

  /** True if a chart with this max_id already exists (admin-scoped check). */
  existsByMaxId(maxId: string): Promise<boolean>;

  /** Update a chart. Returns the updated record, or null if not visible. */
  updatePatient(id: string, input: PatientUpdateInput): Promise<PatientRecord | null>;

  /** List charts visible to the current principal (RLS-scoped). */
  listPatients(): Promise<PatientRecord[]>;

  /**
   * Doctor dashboard listing (WP 3.4 — spec D-13). Returns the doctor's
   * assigned patients (RLS-scoped) with a pending-submission count. When
   * `hospitalId` is provided, only patients with at least one follow_up_row
   * engagement at that hospital are returned.
   */
  listDoctorDashboard(hospitalId: string | null): Promise<DashboardPatientRecord[]>;
}

/**
 * A doctor-dashboard patient summary: the chart plus the count of follow-up
 * rows awaiting review (status='pending'). `hasPending` is the badge flag.
 */
export interface DashboardPatientRecord {
  patient: PatientRecord;
  pendingSubmissionCount: number;
  hasPending: boolean;
}

/** DB port entrypoint: run work inside a single transaction. */
export interface DbPort {
  transaction<T>(fn: (repo: PatientRepository) => Promise<T>): Promise<T>;
}
