/**
 * GET /followup/rows — list the caller's own patient's follow-up rows.
 * RLS scopes visibility to the authenticated patient.
 */
import type { FollowupDeps } from '../deps';
import type { FollowupRequest } from '../http';
import { respondOk, type HttpResponse } from '../envelope';
import { requirePrincipal } from '../http';
import { listRows } from '../services/followup-service';

export async function handleListRows(
  deps: FollowupDeps,
  req: FollowupRequest
): Promise<HttpResponse> {
  const principal = requirePrincipal(req);
  const rows = await listRows(deps, principal);
  return respondOk({ rows });
}
