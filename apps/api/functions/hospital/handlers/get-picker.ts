/**
 * GET /hospitals — the engagement hospital picker (H-07).
 */
import type { HospitalDeps } from '../deps';
import type { HospitalRequest } from '../http';
import { respondOk, type HttpResponse } from '../envelope';
import { requirePrincipal } from '../http';
import { getPicker } from '../services/hospital-service';

export async function handleGetPicker(
  deps: HospitalDeps,
  req: HospitalRequest
): Promise<HttpResponse> {
  const principal = requirePrincipal(req);
  const result = await getPicker(deps, principal, {
    scope: req.query.scope,
    forPatient: req.query.forPatient,
    search: req.query.search,
  });
  return respondOk(result);
}
