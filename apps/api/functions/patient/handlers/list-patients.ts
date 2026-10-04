/**
 * GET /patients — list patient charts visible to the caller (RLS-scoped).
 *
 * Role-aware (WP 3.4 — spec D-13):
 *  - doctor: returns the DOCTOR DASHBOARD — assigned patients with
 *    pending-submission badges, optionally filtered by `?hospital_id=<UUID>` to
 *    patients with at least one follow-up engagement at that hospital.
 *  - patient/caregiver: their own chart (WP 2.1 behavior).
 *  - admin: all charts (WP 2.1 behavior).
 */
import type { PatientDeps } from '../deps';
import type { PatientRequest } from '../http';
import { AppError, respondOk, type HttpResponse } from '../envelope';
import { requirePrincipal } from '../http';
import { listPatients, listDoctorDashboard } from '../services/patient-service';

export async function handleListPatients(
  deps: PatientDeps,
  req: PatientRequest
): Promise<HttpResponse> {
  const principal = requirePrincipal(req);

  if (principal.role === 'doctor') {
    const raw = req.query.hospital_id;
    let hospitalId: string | null = null;
    if (raw !== undefined && raw !== null && raw !== '') {
      if (typeof raw !== 'string' || raw.trim() === '') {
        throw new AppError('VALIDATION_ERROR', "Query 'hospital_id' must be a non-empty string", {
          field: 'hospital_id',
        });
      }
      hospitalId = raw.trim();
    }
    const dashboard = await listDoctorDashboard(deps, principal, hospitalId);
    return respondOk({ patients: dashboard });
  }

  const charts = await listPatients(deps, principal);
  return respondOk({ patients: charts });
}
