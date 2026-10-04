/**
 * Admin hospital endpoints (H-01/H-02/H-03/H-09).
 */
import type { AdminDeps } from '../deps';
import type { AdminRequest } from '../http';
import { AppError, respondOk, type HttpResponse } from '../envelope';
import { parseJsonBody, requireAdmin, requireString, optionalString } from '../http';
import {
  createHospital,
  updateHospital,
  setHospitalStatus,
  searchHospitals,
  type CreateHospitalCommand,
  type UpdateHospitalCommand,
} from '../services/hospital-service';
import type { HospitalStatus } from '../ports/db';

function requireId(req: AdminRequest): string {
  const id = req.pathParams.id;
  if (!id || id.trim() === '') {
    throw new AppError('VALIDATION_ERROR', "Path parameter 'id' is required", { field: 'id' });
  }
  return id.trim();
}

/** POST /admin/hospitals */
export async function handleCreateHospital(
  deps: AdminDeps,
  req: AdminRequest
): Promise<HttpResponse> {
  const principal = requireAdmin(req);
  const body = parseJsonBody(req);
  const cmd: CreateHospitalCommand = {
    hospitalCode: requireString(body, 'hospitalCode'),
    hospitalName: requireString(body, 'hospitalName'),
    hospitalType: requireString(body, 'hospitalType'),
    addressLine1: optionalString(body, 'addressLine1'),
    addressLine2: optionalString(body, 'addressLine2'),
    city: optionalString(body, 'city'),
    state: optionalString(body, 'state'),
    country: optionalString(body, 'country'),
    postalCode: optionalString(body, 'postalCode'),
    phone: optionalString(body, 'phone'),
    websiteUrl: optionalString(body, 'websiteUrl'),
    logoUrl: optionalString(body, 'logoUrl'),
  };
  const hospital = await createHospital(deps, principal, cmd);
  return respondOk(
    { id: hospital.id, hospitalCode: hospital.hospitalCode, status: hospital.status },
    201
  );
}

/** PUT /admin/hospitals/{id} */
export async function handleUpdateHospital(
  deps: AdminDeps,
  req: AdminRequest
): Promise<HttpResponse> {
  const principal = requireAdmin(req);
  const id = requireId(req);
  const body = parseJsonBody(req);
  const cmd: UpdateHospitalCommand = {
    hospitalName: optionalString(body, 'hospitalName'),
    hospitalType: optionalString(body, 'hospitalType'),
    addressLine1: optionalString(body, 'addressLine1'),
    addressLine2: optionalString(body, 'addressLine2'),
    city: optionalString(body, 'city'),
    state: optionalString(body, 'state'),
    country: optionalString(body, 'country'),
    postalCode: optionalString(body, 'postalCode'),
    phone: optionalString(body, 'phone'),
    websiteUrl: optionalString(body, 'websiteUrl'),
    logoUrl: optionalString(body, 'logoUrl'),
  };
  const hospital = await updateHospital(deps, principal, id, cmd);
  return respondOk(hospital);
}

/** PATCH /admin/hospitals/{id}/status */
export async function handleSetHospitalStatus(
  deps: AdminDeps,
  req: AdminRequest
): Promise<HttpResponse> {
  const principal = requireAdmin(req);
  const id = requireId(req);
  const body = parseJsonBody(req);
  const status = requireString(body, 'status');
  if (status !== 'active' && status !== 'inactive') {
    throw new AppError('VALIDATION_ERROR', "Field 'status' must be active or inactive", {
      field: 'status',
    });
  }
  const hospital = await setHospitalStatus(deps, principal, id, status as HospitalStatus);
  return respondOk({ id: hospital.id, status: hospital.status });
}

/** GET /admin/hospitals */
export async function handleSearchHospitals(
  deps: AdminDeps,
  req: AdminRequest
): Promise<HttpResponse> {
  const principal = requireAdmin(req);
  const q = req.query;
  const toInt = (v: string | undefined): number | undefined =>
    v === undefined || v === '' ? undefined : Number(v);
  const result = await searchHospitals(deps, principal, {
    search: q.search,
    type: q.type,
    status: q.status,
    page: toInt(q.page),
    pageSize: toInt(q.pageSize),
  });
  return respondOk(result);
}
