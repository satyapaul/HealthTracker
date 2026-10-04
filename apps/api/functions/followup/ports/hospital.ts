/**
 * Hospital resolution for the engagement-hospital rule (spec §7.2.1, WP 3.1).
 *
 * On create/submit the row captures a denormalized `engagement_hospital_name`
 * snapshot. The authoritative name lives in the `hospitals` table. A hospital
 * is valid for an engagement only when it is EITHER the Virtual Hospital OR an
 * active affiliation of the patient's primary doctor (otherwise the submission
 * is rejected — the LLD's HOSPITAL_NOT_ALLOWED rule).
 *
 * `HospitalPort` is the high-level "resolve + authorize" used by the service.
 * `HospitalLookup` is the low-level data port it depends on; the DB-backed
 * adapter implements the latter and is faked in unit tests.
 */

/** The system-seeded Virtual Hospital's well-known UUID (LLD §1.18). */
export const VIRTUAL_HOSPITAL_ID = '00000000-0000-0000-0000-000000000000';

export interface HospitalRef {
  id: string;
  name: string;
}

export interface HospitalPort {
  /**
   * Resolve a hospital id to its current name for the snapshot, authorizing it
   * for THIS patient's engagement (Virtual, or an active affiliation of the
   * patient's primary doctor). Returns null if the hospital is not allowed —
   * the caller then rejects the submission with VALIDATION_ERROR.
   */
  resolveForEngagement(patientId: string, hospitalId: string): Promise<HospitalRef | null>;
}

/**
 * Low-level hospital data access (RLS-scoped reads). The DB adapter implements
 * this; `DbHospitalPort` composes it into the HospitalPort rule above.
 */
export interface HospitalLookup {
  /** The hospital row (id + name + active flag), or null if it doesn't exist. */
  getHospital(hospitalId: string): Promise<{ id: string; name: string; isActive: boolean } | null>;
  /** The patient's primary doctor id, or null if unset. */
  getPrimaryDoctorId(patientId: string): Promise<string | null>;
  /**
   * True if `doctorId` has an ACTIVE affiliation with `hospitalId`
   * (hospital_doctor_affiliations.status = 'active').
   */
  hasActiveAffiliation(doctorId: string, hospitalId: string): Promise<boolean>;
}

/**
 * HospitalPort implemented over a HospitalLookup. Encodes the §7.2.1 rule:
 * Virtual Hospital is always allowed; any other hospital must be active AND an
 * active affiliation of the patient's primary doctor.
 */
export class DbHospitalPort implements HospitalPort {
  constructor(private readonly lookup: HospitalLookup) {}

  async resolveForEngagement(patientId: string, hospitalId: string): Promise<HospitalRef | null> {
    const hospital = await this.lookup.getHospital(hospitalId);
    if (!hospital) return null;

    // Virtual Hospital: always a valid engagement target.
    if (hospitalId === VIRTUAL_HOSPITAL_ID) {
      return { id: hospital.id, name: hospital.name };
    }

    // Any other hospital must be active...
    if (!hospital.isActive) return null;

    // ...and an active affiliation of the patient's primary doctor.
    const primaryDoctorId = await this.lookup.getPrimaryDoctorId(patientId);
    if (!primaryDoctorId) return null;
    if (!(await this.lookup.hasActiveAffiliation(primaryDoctorId, hospitalId))) return null;

    return { id: hospital.id, name: hospital.name };
  }
}
