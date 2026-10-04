/**
 * Admin doctor-hospital affiliation management (WP 3.2 — spec §7.0.3 H-04).
 *
 * Rules (LLD §3.8.1):
 *  - doctorId must reference a user with role 'doctor' (else 404).
 *  - The hospital must exist (else 404).
 *  - At most one affiliation per (doctor, hospital) — duplicate -> 409.
 *  - At most one `is_primary` affiliation per doctor -> 409 (also DB-enforced
 *    by the V8 partial unique index).
 *
 * DoD note: deactivating an affiliation only flips its status; it never mutates
 * historical follow_up_rows.engagement_hospital_id snapshots (those are
 * independent columns captured at submission time).
 */
import { AppError } from '../envelope';
import type { AdminDeps } from '../deps';
import type { Principal } from '../http';
import type {
  AffiliationRecord,
  AffiliationStatus,
  NewAffiliationInput,
  AffiliationUpdateInput,
  SessionContext,
} from '../ports/db';

function adminContext(principal: Principal): SessionContext {
  return { userId: principal.userId, role: 'admin', patientId: null };
}

export interface AddAffiliationCommand {
  doctorId: string;
  roleAtHospital?: string;
  isPrimary?: boolean;
}

/** H-04: add a doctor-hospital affiliation. */
export async function addAffiliation(
  deps: AdminDeps,
  principal: Principal,
  hospitalId: string,
  cmd: AddAffiliationCommand
): Promise<AffiliationRecord> {
  const isPrimary = cmd.isPrimary ?? false;
  const ctx = adminContext(principal);

  const affiliation = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);

    // Hospital must exist.
    if (!(await repo.getHospitalById(hospitalId))) {
      throw new AppError('NOT_FOUND', 'Hospital not found');
    }
    // Target user must exist and be a doctor.
    const role = await repo.getUserRole(cmd.doctorId);
    if (role === null) {
      throw new AppError('NOT_FOUND', 'Doctor not found');
    }
    if (role !== 'doctor') {
      throw new AppError('VALIDATION_ERROR', 'Target user is not a doctor', { field: 'doctorId' });
    }
    // No duplicate affiliation.
    if (await repo.findAffiliation(cmd.doctorId, hospitalId)) {
      throw new AppError('CONFLICT', 'Affiliation already exists');
    }
    // At most one primary per doctor.
    if (isPrimary && (await repo.hasPrimaryAffiliation(cmd.doctorId))) {
      throw new AppError('CONFLICT', 'Doctor already has a primary affiliation');
    }

    const input: NewAffiliationInput = {
      id: deps.ids.uuid(),
      doctorId: cmd.doctorId,
      hospitalId,
      roleAtHospital: cmd.roleAtHospital ?? null,
      isPrimary,
      grantedBy: principal.userId,
    };
    return repo.addAffiliation(input);
  });

  deps.logger.info('admin.affiliation.added', {
    affiliationId: affiliation.id,
    hospitalId,
    doctorId: cmd.doctorId,
    userId: principal.userId,
  });
  return affiliation;
}

export interface UpdateAffiliationCommand {
  roleAtHospital?: string;
  isPrimary?: boolean;
  status?: string;
}

/** H-04: modify or deactivate an affiliation. */
export async function updateAffiliation(
  deps: AdminDeps,
  principal: Principal,
  id: string,
  cmd: UpdateAffiliationCommand
): Promise<AffiliationRecord> {
  const update: AffiliationUpdateInput = {};
  if (cmd.roleAtHospital !== undefined) update.roleAtHospital = cmd.roleAtHospital;
  if (cmd.isPrimary !== undefined) update.isPrimary = cmd.isPrimary;
  if (cmd.status !== undefined) {
    if (cmd.status !== 'active' && cmd.status !== 'inactive') {
      throw new AppError('VALIDATION_ERROR', "Field 'status' is invalid", { field: 'status' });
    }
    update.status = cmd.status as AffiliationStatus;
  }
  if (Object.keys(update).length === 0) {
    throw new AppError('VALIDATION_ERROR', 'No updatable fields were provided');
  }

  const ctx = adminContext(principal);
  const affiliation = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);

    const existing = await repo.getAffiliationById(id);
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Affiliation not found');
    }
    // Promoting to primary must respect the one-primary rule (ignore if this
    // row is already the primary).
    if (update.isPrimary === true && !existing.isPrimary) {
      if (await repo.hasPrimaryAffiliation(existing.doctorId)) {
        throw new AppError('CONFLICT', 'Doctor already has a primary affiliation');
      }
    }
    return repo.updateAffiliation(id, update);
  });

  if (!affiliation) {
    throw new AppError('NOT_FOUND', 'Affiliation not found');
  }
  deps.logger.info('admin.affiliation.updated', {
    affiliationId: id,
    userId: principal.userId,
  });
  return affiliation;
}
