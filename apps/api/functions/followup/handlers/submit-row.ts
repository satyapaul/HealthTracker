/**
 * PUT /followup/rows/{id}/submit — submit a draft row for doctor review.
 * 200 with the row now in status 'pending'.
 */
import type { FollowupDeps } from '../deps';
import type { FollowupRequest } from '../http';
import { AppError, respondOk, type HttpResponse } from '../envelope';
import { requirePrincipal } from '../http';
import { submitRow } from '../services/followup-service';

export async function handleSubmitRow(
  deps: FollowupDeps,
  req: FollowupRequest
): Promise<HttpResponse> {
  const principal = requirePrincipal(req);
  const id = req.pathParams.id;
  if (!id || id.trim() === '') {
    throw new AppError('VALIDATION_ERROR', "Path parameter 'id' is required", { field: 'id' });
  }
  const row = await submitRow(deps, principal, id.trim());
  return respondOk(row);
}
