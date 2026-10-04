/**
 * GET /followup/rows/{id}/attachments — list attachments on a row (RLS-scoped).
 */
import type { FollowupDeps } from '../deps';
import type { FollowupRequest } from '../http';
import { AppError, respondOk, type HttpResponse } from '../envelope';
import { requirePrincipal } from '../http';
import { listAttachments } from '../services/attachment-service';

export async function handleListAttachments(
  deps: FollowupDeps,
  req: FollowupRequest
): Promise<HttpResponse> {
  const principal = requirePrincipal(req);
  const id = req.pathParams.id;
  if (!id || id.trim() === '') {
    throw new AppError('VALIDATION_ERROR', "Path parameter 'id' is required", { field: 'id' });
  }
  const attachments = await listAttachments(deps, principal, id.trim());
  return respondOk({ attachments });
}
