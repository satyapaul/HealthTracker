/**
 * Hospital lookup port.
 *
 * On submission the row captures a denormalized `engagement_hospital_name`
 * snapshot (spec §7.2.1). The authoritative name lives in the `hospitals` table
 * (Phase 3). Modeling it as a port lets WP 2.2 be complete now and Phase 3 wire
 * the real lookup (validate the id is an active affiliation of the patient's
 * primary doctor, or the Virtual Hospital, and return its current name).
 */
export interface HospitalRef {
  id: string;
  name: string;
}

export interface HospitalPort {
  /**
   * Resolve a hospital id to its current name for the snapshot, or null if the
   * id is not a hospital the caller may use for this engagement. Returning null
   * causes the handler to reject the submission with VALIDATION_ERROR.
   */
  resolveForEngagement(hospitalId: string): Promise<HospitalRef | null>;
}
