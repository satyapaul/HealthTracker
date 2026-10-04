/**
 * GET /hospitals/{id} — hospital detail (any authenticated role).
 */
import type { HospitalDeps } from '../deps';
import type { HospitalRequest } from '../http';
import { AppError, respondOk, type HttpResponse } from '../envelope';
import { requirePrincipal } from '../http';
import { getHospitalDetail } from '../services/hospital-service';

export async function handleGetHospital(
  deps: HospitalDeps,
  req: HospitalRequest
): Promise<HttpResponse> {
  const principal = requirePrincipal(req);
  const id = req.pathParams.id;
  if (!id || id.trim() === '') {
    throw new AppError('VALIDATION_ERROR', "Path parameter 'id' is required", { field: 'id' });
  }
  const hospital = await getHospitalDetail(deps, principal, id.trim());
  return respondOk(hospital);
}
