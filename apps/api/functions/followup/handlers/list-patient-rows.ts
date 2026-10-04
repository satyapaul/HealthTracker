/**
 * GET /followup/patients/{patientId}/rows — a doctor's (or admin's) read of a
 * specific patient's follow-up rows across dates (the doctor-dashboard chart
 * feed). Authorization is enforced by the V6 `fur_doctor_select` RLS policy via
 * doctor_patient_assignments; an unassigned doctor receives an empty list.
 */
import type { FollowupDeps } from '../deps';
import type { FollowupRequest } from '../http';
import { AppError, respondOk, type HttpResponse } from '../envelope';
import { requirePrincipal } from '../http';
import { listRowsForPatient } from '../services/followup-service';

export async function handleListPatientRows(
  deps: FollowupDeps,
  req: FollowupRequest
): Promise<HttpResponse> {
  const principal = requirePrincipal(req);
  const patientId = req.pathParams.patientId;
  if (!patientId || patientId.trim() === '') {
    throw new AppError('VALIDATION_ERROR', "Path parameter 'patientId' is required", {
      field: 'patientId',
    });
  }
  const rows = await listRowsForPatient(deps, principal, patientId.trim());
  return respondOk({ rows });
}
