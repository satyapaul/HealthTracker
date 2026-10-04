/**
 * Follow-up row business logic (WP 2.2 — spec §7.2.1).
 *
 * Scope (patient flow only; doctor review is WP 2.3):
 *  - Create a draft row with the full §7.2.1 field catalog (partial entry OK).
 *  - Edit a draft row.
 *  - Submit a draft -> pending (captures the hospital-name snapshot, enforces
 *    the required engagement hospital + at-least-one-lab-value rule, stamps
 *    submitted_at).
 *  - Read / list rows (RLS-scoped).
 *
 * Invariants enforced here (DoD + conventions "must-test"):
 *  - engagement_hospital_id is REQUIRED to create a row (spec §7.2.1).
 *  - A row can only be edited/submitted while status='draft'.
 *  - One row per (patient, pp_date).
 *  - No PHI in logs or error messages; all DB work runs under RLS context.
 */
import { AppError } from '../envelope';
import type { FollowupDeps } from '../deps';
import type { Principal } from '../http';
import type {
  FollowupRowRecord,
  NewFollowupRowInput,
  FollowupRowUpdateInput,
  SessionContext,
} from '../ports/db';
import type { LabValues, DrugLevels, DoseValues } from '../field-catalog';

export type FollowupRowView = FollowupRowRecord;

/** The patient scope for the current principal; throws for non-patient roles. */
function patientSessionContext(principal: Principal): { ctx: SessionContext; patientId: string } {
  if (principal.role !== 'patient' && principal.role !== 'caregiver') {
    // WP 2.2 is the patient submission flow. Doctor review is WP 2.3; admins
    // manage via other tooling. Keep the surface tight and fail-closed.
    throw new AppError('FORBIDDEN', 'Only a patient or caregiver may use follow-up submission');
  }
  const patientId =
    typeof principal.patientId === 'string' && principal.patientId.length > 0
      ? principal.patientId
      : null;
  if (patientId === null) {
    throw new AppError('FORBIDDEN', 'No patient is linked to this account');
  }
  return {
    ctx: { userId: principal.userId, role: principal.role, patientId },
    patientId,
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertPpDate(ppDate: string): string {
  if (!ISO_DATE.test(ppDate)) {
    throw new AppError('VALIDATION_ERROR', "Field 'ppDate' must be an ISO date (YYYY-MM-DD)", {
      field: 'ppDate',
    });
  }
  return ppDate;
}

export interface CreateDraftCommand {
  ppDate: string;
  engagementHospitalId: string;
  labValues: LabValues;
  drugLevels: DrugLevels;
  patientReportedDoses: DoseValues;
  weightKg?: number;
  notes?: string;
}

/**
 * Create a draft follow-up row. engagement_hospital_id is required (spec
 * §7.2.1); the hospital-name snapshot is resolved from the hospital port and
 * stored denormalized. A draft does not notify anyone.
 */
export async function createDraft(
  deps: FollowupDeps,
  principal: Principal,
  cmd: CreateDraftCommand
): Promise<FollowupRowView> {
  const { ctx, patientId } = patientSessionContext(principal);
  const ppDate = assertPpDate(cmd.ppDate);

  // Required engagement hospital (spec §7.2.1) — reject before any write.
  if (!cmd.engagementHospitalId) {
    throw new AppError('VALIDATION_ERROR', "Field 'engagementHospitalId' is required", {
      field: 'engagementHospitalId',
    });
  }
  const hospital = await deps.hospital.resolveForEngagement(patientId, cmd.engagementHospitalId);
  if (!hospital) {
    throw new AppError('VALIDATION_ERROR', 'Selected hospital is not valid for this engagement', {
      field: 'engagementHospitalId',
    });
  }

  const input: NewFollowupRowInput = {
    id: deps.ids.uuid(),
    patientId,
    ppDate,
    labValues: cmd.labValues,
    drugLevels: cmd.drugLevels,
    patientReportedDoses: cmd.patientReportedDoses,
    weightKg: cmd.weightKg ?? null,
    notes: cmd.notes ?? null,
    engagementHospitalId: hospital.id,
    engagementHospitalName: hospital.name,
  };

  const row = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    if (await repo.existsForDate(patientId, ppDate)) {
      throw new AppError('CONFLICT', 'A follow-up row already exists for this date', {
        field: 'ppDate',
      });
    }
    return repo.createRow(input);
  });

  deps.logger.info('followup.row.created', {
    rowId: row.id,
    patientId,
    userId: principal.userId,
    status: row.status,
  });

  return row;
}

export interface UpdateDraftCommand {
  ppDate?: string;
  engagementHospitalId?: string;
  labValues?: LabValues;
  drugLevels?: DrugLevels;
  patientReportedDoses?: DoseValues;
  weightKg?: number;
  notes?: string;
}

/**
 * Edit a draft row. Only the supplied fields change. RLS (status='draft') plus
 * the repository guarantee a submitted row cannot be edited; we surface that as
 * NOT_FOUND to avoid leaking row state.
 */
export async function updateDraft(
  deps: FollowupDeps,
  principal: Principal,
  id: string,
  cmd: UpdateDraftCommand
): Promise<FollowupRowView> {
  const { ctx, patientId } = patientSessionContext(principal);

  const update: FollowupRowUpdateInput = {};
  if (cmd.ppDate !== undefined) update.ppDate = assertPpDate(cmd.ppDate);
  if (cmd.labValues !== undefined) update.labValues = cmd.labValues;
  if (cmd.drugLevels !== undefined) update.drugLevels = cmd.drugLevels;
  if (cmd.patientReportedDoses !== undefined)
    update.patientReportedDoses = cmd.patientReportedDoses;
  if (cmd.weightKg !== undefined) update.weightKg = cmd.weightKg;
  if (cmd.notes !== undefined) update.notes = cmd.notes;

  // A hospital change re-resolves the snapshot.
  if (cmd.engagementHospitalId !== undefined) {
    const hospital = await deps.hospital.resolveForEngagement(patientId, cmd.engagementHospitalId);
    if (!hospital) {
      throw new AppError('VALIDATION_ERROR', 'Selected hospital is not valid for this engagement', {
        field: 'engagementHospitalId',
      });
    }
    update.engagementHospitalId = hospital.id;
    update.engagementHospitalName = hospital.name;
  }

  if (Object.keys(update).length === 0) {
    throw new AppError('VALIDATION_ERROR', 'No updatable fields were provided');
  }

  const row = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    return repo.updateRow(id, update);
  });

  if (!row) {
    throw new AppError('NOT_FOUND', 'Draft follow-up row not found');
  }

  deps.logger.info('followup.row.updated', {
    rowId: row.id,
    patientId: row.patientId,
    userId: principal.userId,
  });

  return row;
}

/**
 * Submit a draft row for doctor review: draft -> pending, stamp submitted_at.
 * Completeness check (submit pseudocode): at least one lab value present. The
 * engagement hospital is already set+validated at create/edit time.
 */
export async function submitRow(
  deps: FollowupDeps,
  principal: Principal,
  id: string
): Promise<FollowupRowView> {
  const { ctx } = patientSessionContext(principal);
  const submittedAt = deps.clock.now().toISOString();

  const row = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    const existing = await repo.findRowById(id);
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Follow-up row not found');
    }
    if (existing.status !== 'draft') {
      throw new AppError('CONFLICT', 'Only a draft row can be submitted');
    }
    // Completeness: engagement hospital (guaranteed on a created row) + at least
    // one lab value.
    if (Object.keys(existing.labValues).length === 0) {
      throw new AppError('VALIDATION_ERROR', 'At least one lab value is required to submit');
    }
    return repo.submitRow(id, submittedAt);
  });

  if (!row) {
    throw new AppError('NOT_FOUND', 'Follow-up row not found');
  }

  deps.logger.info('followup.row.submitted', {
    rowId: row.id,
    patientId: row.patientId,
    userId: principal.userId,
    status: row.status,
  });

  return row;
}

/** Read a single row (RLS-scoped). */
export async function getRow(
  deps: FollowupDeps,
  principal: Principal,
  id: string
): Promise<FollowupRowView> {
  const { ctx } = patientSessionContext(principal);
  const row = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    return repo.findRowById(id);
  });
  if (!row) {
    throw new AppError('NOT_FOUND', 'Follow-up row not found');
  }
  return row;
}

/** List the caller's own patient's rows (RLS-scoped). */
export async function listRows(
  deps: FollowupDeps,
  principal: Principal
): Promise<FollowupRowView[]> {
  const { ctx, patientId } = patientSessionContext(principal);
  const rows = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    return repo.listRowsForPatient(patientId);
  });

  deps.logger.info('followup.row.list', {
    patientId,
    userId: principal.userId,
    count: rows.length,
  });

  return rows;
}
