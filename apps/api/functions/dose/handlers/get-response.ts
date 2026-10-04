/**
 * GET /followup/rows/{id}/response — the doctor response for a row.
 * 404 if none exists or the caller cannot see the row (RLS).
 */
import type { DoseDeps } from '../deps';
import type { DoseRequest } from '../http';
import { AppError, respondOk, type HttpResponse } from '../envelope';
import { requirePrincipal } from '../http';
import { getResponse } from '../services/review-service';

export async function handleGetResponse(deps: DoseDeps, req: DoseRequest): Promise<HttpResponse> {
  const principal = requirePrincipal(req);
  const id = req.pathParams.id;
  if (!id || id.trim() === '') {
    throw new AppError('VALIDATION_ERROR', "Path parameter 'id' is required", { field: 'id' });
  }
  const response = await getResponse(deps, principal, id.trim());
  return respondOk(response);
}
