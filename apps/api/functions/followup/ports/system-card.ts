/**
 * System-card poster port (WP 5.2 — C-03).
 *
 * On a follow-up submission the system posts an automated card into the
 * patient's care-team chat thread (e.g. "Patient submitted labs for 2026-08-16
 * at Sanjay Gandhi Memorial Hospital" — the hospital name is required, DoD).
 *
 * The concrete adapter (wired in infra) delegates to the chat domain's
 * postSystemCard. Posting a card is a resilient SIDE EFFECT of submit — a
 * failure here is logged, never thrown, so the submission still succeeds.
 */
export interface SystemCardPoster {
  postFollowUpSubmitted(input: {
    patientId: string;
    followUpRowId: string;
    ppDate: string;
    engagementHospitalName: string;
  }): Promise<void>;
}
