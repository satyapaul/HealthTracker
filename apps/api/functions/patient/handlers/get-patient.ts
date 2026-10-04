/**
 * GET /patients/{id} — read a single patient chart.
 * RLS scopes visibility; a chart the caller cannot see returns 404.
 */
import type { PatientDeps } from '../deps';
import type { PatientRequest } from '../http';
import { AppError, respondOk, type HttpResponse } from '../envelope';
import { requirePrincipal } from '../http';
import { getPatientById } from '../services/patient-service';

export async function handleGetPatient(
  deps: PatientDeps,
  req: PatientRequest
): Promise<HttpResponse> {
  const principal = requirePrincipal(req);
  const id = req.pathParams.id;
  if (!id || id.trim() === '') {
    throw new AppError('VALIDATION_ERROR', "Path parameter 'id' is required", { field: 'id' });
  }

  const chart = await getPatientById(deps, principal, id.trim());
  return respondOk(chart);
}
