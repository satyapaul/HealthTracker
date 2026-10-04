/**
 * PUT /followup/rows/{id}/response — doctor reviews a pending row.
 * 200 with { responseId, rowId, status, doseChanges, response }.
 */
import type { DoseDeps } from '../deps';
import type { DoseRequest } from '../http';
import { AppError, respondOk, type HttpResponse } from '../envelope';
import { parseJsonBody, requirePrincipal, optionalString, optionalInt } from '../http';
import { parseDoses } from '../doses';
import { submitReview, type SubmitReviewCommand } from '../services/review-service';

function parseAdditionalTests(raw: unknown): unknown[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new AppError('VALIDATION_ERROR', "Field 'additionalTests' must be an array", {
      field: 'additionalTests',
    });
  }
  return raw;
}

export async function handleSubmitReview(deps: DoseDeps, req: DoseRequest): Promise<HttpResponse> {
  const principal = requirePrincipal(req);
  const id = req.pathParams.id;
  if (!id || id.trim() === '') {
    throw new AppError('VALIDATION_ERROR', "Path parameter 'id' is required", { field: 'id' });
  }
  const body = parseJsonBody(req);

  const cmd: SubmitReviewCommand = {
    doctorPrescribedDoses: parseDoses(body.doctorPrescribedDoses),
    additionalTests: parseAdditionalTests(body.additionalTests),
    additionalMedications: optionalString(body, 'additionalMedications'),
    clinicalNotes: optionalString(body, 'clinicalNotes'),
    nextFollowupIntervalDays: optionalInt(body, 'nextFollowupIntervalDays'),
    doseChangeReason: optionalString(body, 'doseChangeReason'),
  };

  const result = await submitReview(deps, principal, id.trim(), cmd);
  return respondOk(result);
}
