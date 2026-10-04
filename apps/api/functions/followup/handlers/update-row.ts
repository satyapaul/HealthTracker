/**
 * PATCH /followup/rows/{id} — edit a draft follow-up row.
 * 200 with the updated draft. A submitted row surfaces as 404 (RLS).
 */
import type { FollowupDeps } from '../deps';
import type { FollowupRequest } from '../http';
import { AppError, respondOk, type HttpResponse } from '../envelope';
import { parseJsonBody, requirePrincipal, optionalString, optionalNumber } from '../http';
import { parseLabValues, parseDrugLevels, parseDoses } from '../field-catalog';
import { updateDraft, type UpdateDraftCommand } from '../services/followup-service';

export async function handleUpdateRow(
  deps: FollowupDeps,
  req: FollowupRequest
): Promise<HttpResponse> {
  const principal = requirePrincipal(req);
  const id = req.pathParams.id;
  if (!id || id.trim() === '') {
    throw new AppError('VALIDATION_ERROR', "Path parameter 'id' is required", { field: 'id' });
  }
  const body = parseJsonBody(req);

  const cmd: UpdateDraftCommand = {
    ppDate: optionalString(body, 'ppDate'),
    engagementHospitalId: optionalString(body, 'engagementHospitalId'),
    weightKg: optionalNumber(body, 'weightKg'),
    notes: optionalString(body, 'notes'),
  };
  // JSONB groups are only touched when the client supplies them.
  if (body.labValues !== undefined) cmd.labValues = parseLabValues(body.labValues);
  if (body.drugLevels !== undefined) cmd.drugLevels = parseDrugLevels(body.drugLevels);
  if (body.patientReportedDoses !== undefined)
    cmd.patientReportedDoses = parseDoses(body.patientReportedDoses);

  const row = await updateDraft(deps, principal, id.trim(), cmd);
  return respondOk(row);
}
