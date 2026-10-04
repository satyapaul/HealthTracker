/**
 * Reminder-cancellation port (WP 4.2 — spec §7.6, LLD §4.3 submit pseudocode).
 *
 * When a patient submits a follow-up row, the pending reminders for that
 * patient's scheduled `follow_up` milestone are cancelled and the milestone is
 * linked to the submitted row (so a patient who submits early is not nagged).
 *
 * The concrete adapter (DB UPDATEs under the patient RLS context) is wired in
 * the infra step; the followup service calls this port inside the submit
 * transaction. It must no-op safely when the patient has no scheduled follow-up
 * milestone (e.g. ad-hoc submissions).
 */
export interface ReminderCancellation {
  /** The linked milestone id, or null if there was none to cancel. */
  milestoneId: string | null;
  /** How many pending reminders were cancelled. */
  cancelledCount: number;
}

export interface ReminderCanceller {
  /**
   * Cancel pending reminders for the patient's next scheduled follow_up
   * milestone and link it to `followUpRowId`. Safe no-op (returns
   * { milestoneId: null, cancelledCount: 0 }) when there is no such milestone.
   */
  cancelPendingForFollowup(patientId: string, followUpRowId: string): Promise<ReminderCancellation>;
}
