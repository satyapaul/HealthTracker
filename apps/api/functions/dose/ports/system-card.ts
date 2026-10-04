/**
 * System-card poster port (WP 5.2 — C-03) for the dose (review) domain.
 *
 * On a doctor review that changes doses, the system posts a card into the
 * patient's care-team chat thread (e.g. "Doctor updated pred dose to 5").
 * Resilient side effect: a card failure is logged, never thrown, so the review
 * still succeeds. The concrete adapter (infra) delegates to the chat domain.
 */
export interface DoseCardChange {
  fieldName: string;
  newValue: string;
}

export interface SystemCardPoster {
  postDoseChanges(input: {
    patientId: string;
    followUpRowId: string;
    changes: DoseCardChange[];
  }): Promise<void>;
}
