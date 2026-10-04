/**
 * GET /patients — list patient charts visible to the caller (RLS-scoped).
 * patient/caregiver see their own; admin sees all; doctor sees none until the
 * Phase 6 care-team policy is added.
 */
import type { PatientDeps } from '../deps';
import type { PatientRequest } from '../http';
import { respondOk, type HttpResponse } from '../envelope';
import { requirePrincipal } from '../http';
import { listPatients } from '../services/patient-service';

export async function handleListPatients(
  deps: PatientDeps,
  req: PatientRequest
): Promise<HttpResponse> {
  const principal = requirePrincipal(req);
  const charts = await listPatients(deps, principal);
  return respondOk({ patients: charts });
}
