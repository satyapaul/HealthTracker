/**
 * POST /milestones — a doctor creates a custom milestone (+ reminder schedule).
 */
import type { MilestoneDeps } from '../deps';
import type { MilestoneRequest } from '../http';
import { respondOk, type HttpResponse } from '../envelope';
import { parseJsonBody, requirePrincipal, requireString, optionalString } from '../http';
import { createMilestone, type CreateMilestoneCommand } from '../services/milestone-service';

export async function handleCreateMilestone(
  deps: MilestoneDeps,
  req: MilestoneRequest
): Promise<HttpResponse> {
  const principal = requirePrincipal(req);
  const body = parseJsonBody(req);
  const cmd: CreateMilestoneCommand = {
    patientId: requireString(body, 'patientId'),
    type: requireString(body, 'type'),
    title: requireString(body, 'title'),
    description: optionalString(body, 'description'),
    dueDate: requireString(body, 'dueDate'),
  };
  const result = await createMilestone(deps, principal, cmd);
  return respondOk(
    {
      id: result.milestone.id,
      status: result.milestone.status,
      reminderCount: result.reminderCount,
    },
    201
  );
}
