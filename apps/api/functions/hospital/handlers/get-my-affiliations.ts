/**
 * GET /doctors/me/affiliations — the doctor's own affiliations (H-05).
 */
import type { HospitalDeps } from '../deps';
import type { HospitalRequest } from '../http';
import { respondOk, type HttpResponse } from '../envelope';
import { requirePrincipal } from '../http';
import { getMyAffiliations } from '../services/hospital-service';

export async function handleGetMyAffiliations(
  deps: HospitalDeps,
  req: HospitalRequest
): Promise<HttpResponse> {
  const principal = requirePrincipal(req);
  const result = await getMyAffiliations(deps, principal);
  return respondOk(result);
}
