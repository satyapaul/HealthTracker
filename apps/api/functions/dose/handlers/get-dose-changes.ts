/**
 * GET /followup/rows/{id}/dose-changes — dose-change history for a row.
 * RLS scopes visibility; a row the caller cannot see yields an empty list.
 */
import type { DoseDeps } from '../deps';
import type { DoseRequest } from '../http';
import { AppError, respondOk, type HttpResponse } from '../envelope';
import { requirePrincipal } from '../http';
import { getDoseChanges } from '../services/review-service';

export async function handleGetDoseChanges(
  deps: DoseDeps,
  req: DoseRequest
): Promise<HttpResponse> {
  const principal = requirePrincipal(req);
  const id = req.pathParams.id;
  if (!id || id.trim() === '') {
    throw new AppError('VALIDATION_ERROR', "Path parameter 'id' is required", { field: 'id' });
  }
  const doseChanges = await getDoseChanges(deps, principal, id.trim());
  return respondOk({ doseChanges });
}
