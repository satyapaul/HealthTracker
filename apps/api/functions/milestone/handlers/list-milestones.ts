/**
 * GET /milestones?patientId= — list a patient's milestones (RLS-scoped).
 * patient/caregiver read their own (patientId from context); doctor/admin pass
 * ?patientId explicitly.
 */
import type { MilestoneDeps } from '../deps';
import type { MilestoneRequest } from '../http';
import { AppError, respondOk, type HttpResponse } from '../envelope';
import { requirePrincipal } from '../http';
import { listMilestones } from '../services/milestone-service';

export async function handleListMilestones(
  deps: MilestoneDeps,
  req: MilestoneRequest
): Promise<HttpResponse> {
  const principal = requirePrincipal(req);

  let patientId: string;
  if (principal.role === 'patient' || principal.role === 'caregiver') {
    patientId =
      typeof principal.patientId === 'string' && principal.patientId.length > 0
        ? principal.patientId
        : '';
    if (patientId === '') {
      throw new AppError('FORBIDDEN', 'No patient linked to this account');
    }
  } else {
    const q = req.query.patientId;
    if (!q || q.trim() === '') {
      throw new AppError('VALIDATION_ERROR', "Query 'patientId' is required", {
        field: 'patientId',
      });
    }
    patientId = q.trim();
  }

  const milestones = await listMilestones(deps, principal, patientId);
  return respondOk({ milestones });
}
