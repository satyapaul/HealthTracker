/**
 * Admin affiliation endpoints (H-04).
 */
import type { AdminDeps } from '../deps';
import type { AdminRequest } from '../http';
import { AppError, respondOk, type HttpResponse } from '../envelope';
import {
  parseJsonBody,
  requireAdmin,
  requireString,
  optionalString,
  optionalBoolean,
} from '../http';
import {
  addAffiliation,
  updateAffiliation,
  type AddAffiliationCommand,
  type UpdateAffiliationCommand,
} from '../services/affiliation-service';

/** POST /admin/hospitals/{id}/affiliations */
export async function handleAddAffiliation(
  deps: AdminDeps,
  req: AdminRequest
): Promise<HttpResponse> {
  const principal = requireAdmin(req);
  const hospitalId = req.pathParams.id;
  if (!hospitalId || hospitalId.trim() === '') {
    throw new AppError('VALIDATION_ERROR', "Path parameter 'id' is required", { field: 'id' });
  }
  const body = parseJsonBody(req);
  const cmd: AddAffiliationCommand = {
    doctorId: requireString(body, 'doctorId'),
    roleAtHospital: optionalString(body, 'roleAtHospital'),
    isPrimary: optionalBoolean(body, 'isPrimary'),
  };
  const affiliation = await addAffiliation(deps, principal, hospitalId.trim(), cmd);
  return respondOk({ affiliationId: affiliation.id, status: affiliation.status }, 201);
}

/** PATCH /admin/affiliations/{id} */
export async function handleUpdateAffiliation(
  deps: AdminDeps,
  req: AdminRequest
): Promise<HttpResponse> {
  const principal = requireAdmin(req);
  const id = req.pathParams.id;
  if (!id || id.trim() === '') {
    throw new AppError('VALIDATION_ERROR', "Path parameter 'id' is required", { field: 'id' });
  }
  const body = parseJsonBody(req);
  const cmd: UpdateAffiliationCommand = {
    roleAtHospital: optionalString(body, 'roleAtHospital'),
    isPrimary: optionalBoolean(body, 'isPrimary'),
    status: optionalString(body, 'status'),
  };
  const affiliation = await updateAffiliation(deps, principal, id.trim(), cmd);
  return respondOk(affiliation);
}
