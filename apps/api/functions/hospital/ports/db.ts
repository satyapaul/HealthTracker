/**
 * Database port for the hospital (read/picker) domain (WP 3.3 — spec §7.0, H-07/H-05).
 *
 * Hospitals are non-PHI reference data (RLS allows read-all). Affiliation reads
 * and the patient-access check run under the caller's RLS context. Parameterized
 * queries only; the concrete adapter is faked in unit tests.
 */

export type UserRole = 'patient' | 'caregiver' | 'doctor' | 'admin';
export type HospitalType = 'general' | 'specialty' | 'clinic' | 'daycare' | 'virtual';
export type HospitalStatus = 'active' | 'inactive';
export type AffiliationStatus = 'active' | 'inactive';

export interface SessionContext {
  userId: string;
  role: UserRole;
  patientId?: string | null;
}

/** Picker/detail projection of a hospital. */
export interface HospitalSummary {
  id: string;
  hospitalCode: string;
  hospitalName: string;
  hospitalType: HospitalType;
  city: string | null;
  logoUrl: string | null;
  status: HospitalStatus;
}

/** A doctor's affiliation joined with its hospital (H-05). */
export interface AffiliationView {
  affiliationId: string;
  hospital: { id: string; hospitalName: string; hospitalCode: string };
  roleAtHospital: string | null;
  isPrimary: boolean;
  status: AffiliationStatus;
}

export interface HospitalRepository {
  setSessionContext(ctx: SessionContext): Promise<void>;

  /** The Virtual Hospital summary (always present, system-seeded). */
  getVirtualHospital(): Promise<HospitalSummary | null>;

  /** A hospital by id (any status), or null. */
  getHospitalById(id: string): Promise<HospitalSummary | null>;

  /**
   * Active hospitals the given doctor has an ACTIVE affiliation with (excludes
   * the Virtual Hospital, which the service pins separately). Ordered by name.
   */
  listActiveAffiliatedHospitals(doctorId: string): Promise<HospitalSummary[]>;

  /** A patient's primary doctor id, or null if unset / patient not found. */
  getPrimaryDoctorId(patientId: string): Promise<string | null>;

  /** True if the doctor is assigned to the patient (doctor_patient_assignments). */
  isDoctorAssignedToPatient(doctorId: string, patientId: string): Promise<boolean>;

  /** The doctor's own affiliations joined with hospital name/code (H-05). */
  listDoctorAffiliations(doctorId: string): Promise<AffiliationView[]>;
}

/** DB port entrypoint: run work inside a single transaction. */
export interface DbPort {
  transaction<T>(fn: (repo: HospitalRepository) => Promise<T>): Promise<T>;
}
