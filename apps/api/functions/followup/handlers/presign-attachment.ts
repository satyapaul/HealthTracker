/**
 * POST /followup/rows/{id}/attachments/presign — mint a presigned upload URL.
 * 201 with { uploadUrl, objectKey, expiresAt }.
 */
import type { FollowupDeps } from '../deps';
import type { FollowupRequest } from '../http';
import { AppError, respondOk, type HttpResponse } from '../envelope';
import { parseJsonBody, requirePrincipal, requireString, optionalNumber } from '../http';
import { presignAttachment, type PresignCommand } from '../services/attachment-service';

export async function handlePresignAttachment(
  deps: FollowupDeps,
  req: FollowupRequest
): Promise<HttpResponse> {
  const principal = requirePrincipal(req);
  const id = req.pathParams.id;
  if (!id || id.trim() === '') {
    throw new AppError('VALIDATION_ERROR', "Path parameter 'id' is required", { field: 'id' });
  }
  const body = parseJsonBody(req);

  const size = optionalNumber(body, 'fileSizeBytes');
  if (size === undefined) {
    throw new AppError('VALIDATION_ERROR', "Field 'fileSizeBytes' is required", {
      field: 'fileSizeBytes',
    });
  }

  const cmd: PresignCommand = {
    filename: requireString(body, 'filename'),
    mimeType: requireString(body, 'mimeType'),
    fileSizeBytes: size,
  };

  const result = await presignAttachment(deps, principal, id.trim(), cmd);
  return respondOk(result, 201);
}
