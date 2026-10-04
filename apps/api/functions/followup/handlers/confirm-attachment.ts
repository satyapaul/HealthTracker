/**
 * POST /followup/rows/{id}/attachments/confirm — register an uploaded file.
 * 201 with { attachmentId, scanStatus } (scan runs asynchronously).
 */
import type { FollowupDeps } from '../deps';
import type { FollowupRequest } from '../http';
import { AppError, respondOk, type HttpResponse } from '../envelope';
import { parseJsonBody, requirePrincipal, requireString } from '../http';
import { confirmAttachment, type ConfirmCommand } from '../services/attachment-service';

export async function handleConfirmAttachment(
  deps: FollowupDeps,
  req: FollowupRequest
): Promise<HttpResponse> {
  const principal = requirePrincipal(req);
  const id = req.pathParams.id;
  if (!id || id.trim() === '') {
    throw new AppError('VALIDATION_ERROR', "Path parameter 'id' is required", { field: 'id' });
  }
  const body = parseJsonBody(req);

  const cmd: ConfirmCommand = {
    objectKey: requireString(body, 'objectKey'),
    filename: requireString(body, 'filename'),
  };

  const attachment = await confirmAttachment(deps, principal, id.trim(), cmd);
  return respondOk({ attachmentId: attachment.id, scanStatus: attachment.scanStatus }, 201);
}
