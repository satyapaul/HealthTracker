/**
 * Doctor-facing milestone business logic (WP 4.2 — LLD §4.5).
 *
 * POST /milestones: an assigned doctor creates a custom milestone (e.g. an
 * extra follow-up or doctor-ordered test) with a future due date; the four
 * reminder_schedules rows are computed and inserted in the same transaction.
 * GET /milestones: list a patient's milestones (RLS-scoped).
 */
import { AppError } from '../envelope';
import type { MilestoneDeps } from '../deps';
import type { Principal } from '../http';
import type { MilestoneRecord, MilestoneType, SessionContext } from '../ports';
import { computeReminderSchedule } from '../reminder-schedule';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CREATABLE_TYPES: readonly MilestoneType[] = [
  'follow_up',
  'post_op_checkpoint',
  'drug_level',
  'doctor_ordered',
];

function doctorContext(principal: Principal): SessionContext {
  if (principal.role !== 'doctor') {
    throw new AppError('FORBIDDEN', 'Only a doctor may create milestones');
  }
  return { userId: principal.userId, role: 'doctor', patientId: null };
}

export interface CreateMilestoneCommand {
  patientId: string;
  type: string;
  title: string;
  description?: string;
  dueDate: string;
}

export interface CreateMilestoneResult {
  milestone: MilestoneRecord;
  reminderCount: number;
}

/** Create a doctor milestone + its reminder schedule. */
export async function createMilestone(
  deps: MilestoneDeps,
  principal: Principal,
  cmd: CreateMilestoneCommand
): Promise<CreateMilestoneResult> {
  const ctx = doctorContext(principal);

  if (!ISO_DATE.test(cmd.dueDate)) {
    throw new AppError('VALIDATION_ERROR', "Field 'dueDate' must be an ISO date (YYYY-MM-DD)", {
      field: 'dueDate',
    });
  }
  // dueDate must not be in the past (compared by date, in UTC day terms).
  const todayIso = deps.clock.now().toISOString().slice(0, 10);
  if (cmd.dueDate < todayIso) {
    throw new AppError('VALIDATION_ERROR', 'dueDate cannot be in the past', { field: 'dueDate' });
  }
  if (!(CREATABLE_TYPES as readonly string[]).includes(cmd.type)) {
    throw new AppError('VALIDATION_ERROR', "Field 'type' is invalid", { field: 'type' });
  }
  const type = cmd.type as MilestoneType;

  const reminders = computeReminderSchedule(cmd.dueDate, deps.config.tzOffsetMinutes);

  const milestone = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    if (!(await repo.isDoctorAssignedToPatient(principal.userId, cmd.patientId))) {
      throw new AppError('FORBIDDEN', 'Not assigned to this patient');
    }
    const created = await repo.createMilestone({
      id: deps.ids.uuid(),
      patientId: cmd.patientId,
      type,
      title: cmd.title,
      description: cmd.description ?? null,
      dueDate: cmd.dueDate,
      source: 'doctor',
    });
    for (const r of reminders) {
      await repo.addReminder({
        id: deps.ids.uuid(),
        milestoneId: created.id,
        reminderType: r.reminderType,
        offsetDays: r.offsetDays,
        scheduledAt: r.scheduledAt,
      });
    }
    return created;
  });

  deps.logger.info('milestone.created', {
    milestoneId: milestone.id,
    patientId: cmd.patientId,
    userId: principal.userId,
    reminderCount: reminders.length,
  });

  return { milestone, reminderCount: reminders.length };
}

/** List a patient's milestones (RLS-scoped: patient own, assigned doctor, admin). */
export async function listMilestones(
  deps: MilestoneDeps,
  principal: Principal,
  patientId: string
): Promise<MilestoneRecord[]> {
  let ctx: SessionContext;
  if (principal.role === 'patient' || principal.role === 'caregiver') {
    const pid =
      typeof principal.patientId === 'string' && principal.patientId.length > 0
        ? principal.patientId
        : null;
    if (pid === null) throw new AppError('FORBIDDEN', 'No patient linked to this account');
    ctx = { userId: principal.userId, role: principal.role, patientId: pid };
  } else {
    ctx = { userId: principal.userId, role: principal.role, patientId: null };
  }

  return deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    return repo.listMilestonesForPatient(patientId);
  });
}
