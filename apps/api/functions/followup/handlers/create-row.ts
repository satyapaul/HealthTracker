/**
 * POST /followup/rows — create a draft follow-up row.
 * 201 with the created draft on success.
 */
import type { FollowupDeps } from '../deps';
import type { FollowupRequest } from '../http';
import { respondOk, type HttpResponse } from '../envelope';
import {
  parseJsonBody,
  requirePrincipal,
  requireString,
  optionalString,
  optionalNumber,
} from '../http';
import { parseLabValues, parseDrugLevels, parseDoses } from '../field-catalog';
import { createDraft, type CreateDraftCommand } from '../services/followup-service';

export async function handleCreateRow(
  deps: FollowupDeps,
  req: FollowupRequest
): Promise<HttpResponse> {
  const principal = requirePrincipal(req);
  const body = parseJsonBody(req);

  const cmd: CreateDraftCommand = {
    ppDate: requireString(body, 'ppDate'),
    engagementHospitalId: requireString(body, 'engagementHospitalId'),
    labValues: parseLabValues(body.labValues),
    drugLevels: parseDrugLevels(body.drugLevels),
    patientReportedDoses: parseDoses(body.patientReportedDoses),
    weightKg: optionalNumber(body, 'weightKg'),
    notes: optionalString(body, 'notes'),
  };

  const row = await createDraft(deps, principal, cmd);
  return respondOk(row, 201);
}
