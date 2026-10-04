/**
 * GET /followup/rows/{id} — read one follow-up row (RLS-scoped).
 */
import type { FollowupDeps } from '../deps';
import type { FollowupRequest } from '../http';
import { AppError, respondOk, type HttpResponse } from '../envelope';
import { requirePrincipal } from '../http';
import { getRow } from '../services/followup-service';

export async function handleGetRow(
  deps: FollowupDeps,
  req: FollowupRequest
): Promise<HttpResponse> {
  const principal = requirePrincipal(req);
  const id = req.pathParams.id;
  if (!id || id.trim() === '') {
    throw new AppError('VALIDATION_ERROR', "Path parameter 'id' is required", { field: 'id' });
  }
  const row = await getRow(deps, principal, id.trim());
  return respondOk(row);
}
