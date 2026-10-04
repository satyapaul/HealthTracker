/**
 * Route dispatch for the followup domain. Maps method+path (with the
 * `/followup/rows/{id}` parameter and the `/submit` sub-action) to a handler
 * and maps thrown AppErrors to the standard error envelope. Logs the error
 * CODE only — never PHI.
 */
import type { FollowupDeps } from './deps';
import type { FollowupRequest } from './http';
import { AppError, respondError, type HttpResponse } from './envelope';
import { handleCreateRow } from './handlers/create-row';
import { handleUpdateRow } from './handlers/update-row';
import { handleSubmitRow } from './handlers/submit-row';
import { handleGetRow } from './handlers/get-row';
import { handleListRows } from './handlers/list-rows';
import { handleListPatientRows } from './handlers/list-patient-rows';
import { handlePresignAttachment } from './handlers/presign-attachment';
import { handleConfirmAttachment } from './handlers/confirm-attachment';
import { handleListAttachments } from './handlers/list-attachments';

type RouteHandler = (deps: FollowupDeps, req: FollowupRequest) => Promise<HttpResponse>;

/** Strip trailing slash (except root). */
function normalizePath(path: string): string {
  const clean = path.replace(/\/+$/, '');
  return clean === '' ? '/' : clean;
}

/** Resolve a method+path to a handler plus any extracted path params. */
function resolve(
  method: string,
  path: string
): { handler: RouteHandler; pathParams: Record<string, string> } | null {
  const m = method.toUpperCase();
  const p = normalizePath(path);

  if (p === '/followup/rows') {
    if (m === 'POST') return { handler: handleCreateRow, pathParams: {} };
    if (m === 'GET') return { handler: handleListRows, pathParams: {} };
    return null;
  }

  // /followup/patients/{patientId}/rows — doctor/admin read of a patient chart.
  const patientRowsMatch = /^\/followup\/patients\/([^/]+)\/rows$/.exec(p);
  if (patientRowsMatch) {
    const patientId = decodeURIComponent(patientRowsMatch[1]);
    if (m === 'GET') return { handler: handleListPatientRows, pathParams: { patientId } };
    return null;
  }

  // /followup/rows/{id}/submit
  const submitMatch = /^\/followup\/rows\/([^/]+)\/submit$/.exec(p);
  if (submitMatch) {
    const id = decodeURIComponent(submitMatch[1]);
    if (m === 'PUT' || m === 'POST') return { handler: handleSubmitRow, pathParams: { id } };
    return null;
  }

  // /followup/rows/{id}/attachments/presign
  const presignMatch = /^\/followup\/rows\/([^/]+)\/attachments\/presign$/.exec(p);
  if (presignMatch) {
    const id = decodeURIComponent(presignMatch[1]);
    if (m === 'POST') return { handler: handlePresignAttachment, pathParams: { id } };
    return null;
  }

  // /followup/rows/{id}/attachments/confirm
  const confirmMatch = /^\/followup\/rows\/([^/]+)\/attachments\/confirm$/.exec(p);
  if (confirmMatch) {
    const id = decodeURIComponent(confirmMatch[1]);
    if (m === 'POST') return { handler: handleConfirmAttachment, pathParams: { id } };
    return null;
  }

  // /followup/rows/{id}/attachments
  const attachmentsMatch = /^\/followup\/rows\/([^/]+)\/attachments$/.exec(p);
  if (attachmentsMatch) {
    const id = decodeURIComponent(attachmentsMatch[1]);
    if (m === 'GET') return { handler: handleListAttachments, pathParams: { id } };
    return null;
  }

  // /followup/rows/{id}
  const itemMatch = /^\/followup\/rows\/([^/]+)$/.exec(p);
  if (itemMatch) {
    const id = decodeURIComponent(itemMatch[1]);
    if (m === 'GET') return { handler: handleGetRow, pathParams: { id } };
    if (m === 'PATCH') return { handler: handleUpdateRow, pathParams: { id } };
    return null;
  }

  return null;
}

export async function route(deps: FollowupDeps, req: FollowupRequest): Promise<HttpResponse> {
  const routeKey = `${req.method.toUpperCase()} ${normalizePath(req.path)}`;
  try {
    const match = resolve(req.method, req.path);
    if (!match) {
      throw new AppError('NOT_FOUND', 'Unknown route');
    }
    const reqWithParams: FollowupRequest = { ...req, pathParams: match.pathParams };
    return await match.handler(deps, reqWithParams);
  } catch (err) {
    if (err instanceof AppError) {
      deps.logger.warn('followup.request.error', { route: routeKey, code: err.code });
    } else {
      deps.logger.error('followup.request.unexpected', { route: routeKey });
    }
    return respondError(err);
  }
}
