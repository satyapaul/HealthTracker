/**
 * Doctor review business logic (WP 2.3 — spec §7.2 / §7.4, LLD §4.4).
 *
 * The review flow (PUT /followup/rows/{id}/response), one transaction:
 *   1. Load the row (RLS scopes to assigned patients); verify status='pending'.
 *   2. Guard the one-response-per-row rule (doctor_responses UNIQUE).
 *   3. Diff doctor_prescribed_doses vs the prior/patient-reported doses and
 *      append a dose_changes row per changed field (immutable audit).
 *   4. Mark the row reviewed: set doctor_prescribed_doses, status='reviewed',
 *      reviewed_at/by. Prescribed doses are a SEPARATE field from the patient's
 *      reported doses, so the two are always visually distinguishable
 *      (replacing the paper form's "red ink"), satisfying the DoD.
 *   5. Append the doctor_response.
 *
 * Scoped OUT of WP 2.3 (Phase 4): milestone/reminder side-effects (LLD §4.4
 * steps 8-9) and the SQS DoctorResponded event.
 *
 * Doctor access is gated by the V6 RLS (doctor_patient_assignments). The
 * service adds the role check and the status/duplicate guards; a doctor not
 * assigned to the patient simply cannot see the row (NOT_FOUND).
 */
import { AppError } from '../envelope';
import type { DoseDeps } from '../deps';
import type { Principal } from '../http';
import type { DoseChangeRecord, DoctorResponseRecord, SessionContext } from '../ports/db';
import { diffDoses, type DoseValues } from '../doses';

function doctorContext(principal: Principal): SessionContext {
  if (principal.role !== 'doctor') {
    throw new AppError('FORBIDDEN', 'Only a doctor may review a follow-up row');
  }
  return { userId: principal.userId, role: 'doctor', patientId: null };
}

/** Any role's RLS context, for the read endpoints (patient/caregiver/doctor/admin). */
function readContext(principal: Principal): SessionContext {
  if (principal.role === 'patient' || principal.role === 'caregiver') {
    const patientId =
      typeof principal.patientId === 'string' && principal.patientId.length > 0
        ? principal.patientId
        : null;
    if (patientId === null) {
      throw new AppError('FORBIDDEN', 'No patient is linked to this account');
    }
    return { userId: principal.userId, role: principal.role, patientId };
  }
  return { userId: principal.userId, role: principal.role, patientId: null };
}

export interface SubmitReviewCommand {
  doctorPrescribedDoses: DoseValues;
  additionalTests: unknown[];
  additionalMedications?: string;
  clinicalNotes?: string;
  nextFollowupIntervalDays?: number;
  /** Optional free-text reason attached to each recorded dose change. */
  doseChangeReason?: string;
}

export interface ReviewResult {
  responseId: string;
  rowId: string;
  status: 'reviewed';
  doseChanges: DoseChangeRecord[];
  response: DoctorResponseRecord;
}

/** Submit a doctor review for a pending follow-up row. */
export async function submitReview(
  deps: DoseDeps,
  principal: Principal,
  rowId: string,
  cmd: SubmitReviewCommand
): Promise<ReviewResult> {
  const ctx = doctorContext(principal);
  const reviewedAt = deps.clock.now().toISOString();

  const result = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);

    const row = await repo.findRowForReview(rowId);
    if (!row) {
      // Not assigned / does not exist — do not leak which.
      throw new AppError('NOT_FOUND', 'Follow-up row not found');
    }
    if (row.status !== 'pending') {
      throw new AppError('CONFLICT', 'Only a pending row can be reviewed');
    }
    if (await repo.responseExists(rowId)) {
      throw new AppError('CONFLICT', 'This row has already been reviewed');
    }

    // Append a dose-change audit row per changed field.
    const diffs = diffDoses(
      cmd.doctorPrescribedDoses,
      row.patientReportedDoses,
      row.doctorPrescribedDoses
    );
    const doseChanges: DoseChangeRecord[] = [];
    for (const d of diffs) {
      const rec = await repo.insertDoseChange({
        id: deps.ids.uuid(),
        followUpRowId: rowId,
        fieldName: d.fieldName,
        oldValue: d.oldValue,
        newValue: d.newValue,
        changedBy: principal.userId,
        changedAt: reviewedAt,
        reason: cmd.doseChangeReason ?? null,
      });
      doseChanges.push(rec);
    }

    // Mark the row reviewed with the doctor's prescribed doses (distinct field).
    await repo.markReviewed(rowId, cmd.doctorPrescribedDoses, principal.userId, reviewedAt);

    // Append the structured response (one per row).
    const response = await repo.insertResponse({
      id: deps.ids.uuid(),
      followUpRowId: rowId,
      doctorId: principal.userId,
      additionalTests: cmd.additionalTests,
      additionalMedications: cmd.additionalMedications ?? null,
      clinicalNotes: cmd.clinicalNotes ?? null,
      nextFollowupIntervalDays: cmd.nextFollowupIntervalDays ?? null,
      sentAt: reviewedAt,
    });

    return { response, doseChanges, patientId: row.patientId };
  });

  // Post the C-03 DoseChanged system card into the care-team chat thread.
  // Resilient side effect: a card failure must not fail the review. Only post
  // when doses actually changed.
  if (result.doseChanges.length > 0) {
    try {
      await deps.systemCards.postDoseChanges({
        patientId: result.patientId,
        followUpRowId: rowId,
        changes: result.doseChanges.map((d) => ({ fieldName: d.fieldName, newValue: d.newValue })),
      });
    } catch {
      deps.logger.warn('dose.review.systemcard_failed', { rowId });
    }
  }

  deps.logger.info('dose.review.submitted', {
    rowId,
    responseId: result.response.id,
    userId: principal.userId,
    doseChangeCount: result.doseChanges.length,
  });

  return {
    responseId: result.response.id,
    rowId,
    status: 'reviewed',
    doseChanges: result.doseChanges,
    response: result.response,
  };
}

/** Read the dose-change history for a row (RLS-scoped). */
export async function getDoseChanges(
  deps: DoseDeps,
  principal: Principal,
  rowId: string
): Promise<DoseChangeRecord[]> {
  const ctx = readContext(principal);
  return deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    // A row the caller cannot see yields an empty history (RLS), which is the
    // correct non-leaking behavior.
    return repo.listDoseChanges(rowId);
  });
}

/** Read the doctor response for a row (RLS-scoped). */
export async function getResponse(
  deps: DoseDeps,
  principal: Principal,
  rowId: string
): Promise<DoctorResponseRecord> {
  const ctx = readContext(principal);
  const response = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    return repo.findResponse(rowId);
  });
  if (!response) {
    throw new AppError('NOT_FOUND', 'No doctor response for this row');
  }
  return response;
}
