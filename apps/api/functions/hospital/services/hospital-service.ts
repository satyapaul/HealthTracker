/**
 * Hospital read/picker business logic (WP 3.3 — spec §7.0.3 H-07/H-05, LLD §4.16).
 *
 * GET /hospitals picker:
 *   - scope=affiliated   -> source doctor = the calling doctor
 *   - forPatient=:id      -> source doctor = that patient's primary_doctor_id
 *                            (caller must be allowed to see the patient)
 *   The result is the Virtual Hospital pinned first, then the source doctor's
 *   active affiliated active hospitals ordered by name, with an optional inline
 *   name/code search filter. Only active hospitals are returned.
 */
import { AppError } from '../envelope';
import type { HospitalDeps, PickerEntry } from '../deps';
import type { Principal } from '../http';
import type { AffiliationView, HospitalSummary, SessionContext } from '../ports/db';

export const VIRTUAL_HOSPITAL_ID = '00000000-0000-0000-0000-000000000000';

function sessionContext(principal: Principal): SessionContext {
  if (principal.role === 'patient' || principal.role === 'caregiver') {
    const patientId =
      typeof principal.patientId === 'string' && principal.patientId.length > 0
        ? principal.patientId
        : null;
    return { userId: principal.userId, role: principal.role, patientId };
  }
  return { userId: principal.userId, role: principal.role, patientId: null };
}

export interface PickerQuery {
  scope?: string;
  forPatient?: string;
  search?: string;
}

function matchesSearch(h: HospitalSummary, term: string): boolean {
  const s = term.toLowerCase();
  return h.hospitalName.toLowerCase().includes(s) || h.hospitalCode.toLowerCase().includes(s);
}

/**
 * Resolve the "source doctor" whose affiliations drive the picker, enforcing
 * caller access for the forPatient scope.
 */
async function resolveSourceDoctor(
  deps: HospitalDeps,
  principal: Principal,
  query: PickerQuery
): Promise<string> {
  if (query.scope === 'affiliated') {
    if (principal.role !== 'doctor') {
      throw new AppError('FORBIDDEN', 'scope=affiliated is only valid for a doctor');
    }
    return principal.userId;
  }

  if (query.forPatient) {
    const patientId = query.forPatient;
    return deps.db.transaction(async (repo) => {
      await repo.setSessionContext(sessionContext(principal));

      // Caller-access check for the target patient.
      if (principal.role === 'patient' || principal.role === 'caregiver') {
        if (principal.patientId !== patientId) {
          throw new AppError('FORBIDDEN', 'Cannot access this patient');
        }
      } else if (principal.role === 'doctor') {
        if (!(await repo.isDoctorAssignedToPatient(principal.userId, patientId))) {
          throw new AppError('FORBIDDEN', 'Cannot access this patient');
        }
      }
      // admin: any patient.

      const primaryDoctorId = await repo.getPrimaryDoctorId(patientId);
      if (!primaryDoctorId) {
        // No primary doctor yet: the picker will still show the Virtual Hospital.
        return '';
      }
      return primaryDoctorId;
    });
  }

  throw new AppError('VALIDATION_ERROR', 'Either scope=affiliated or forPatient is required');
}

/** GET /hospitals — the engagement hospital picker (H-07). */
export async function getPicker(
  deps: HospitalDeps,
  principal: Principal,
  query: PickerQuery
): Promise<{ hospitals: PickerEntry[] }> {
  const sourceDoctorId = await resolveSourceDoctor(deps, principal, query);

  // Cache key is per source doctor (empty => "virtual only").
  const cacheKey = `hospitals:picker:${sourceDoctorId || 'none'}`;
  const cached = await deps.pickerCache.get(cacheKey);

  let entries: PickerEntry[];
  if (cached) {
    entries = cached;
  } else {
    entries = await deps.db.transaction(async (repo) => {
      await repo.setSessionContext(sessionContext(principal));

      const virtual = await repo.getVirtualHospital();
      const pinned: PickerEntry[] = virtual ? [{ ...virtual, pinned: true }] : [];

      const affiliated = sourceDoctorId
        ? await repo.listActiveAffiliatedHospitals(sourceDoctorId)
        : [];
      const rest: PickerEntry[] = affiliated
        .filter((h) => h.status === 'active' && h.id !== VIRTUAL_HOSPITAL_ID)
        .map((h) => ({ ...h, pinned: false }));

      return [...pinned, ...rest];
    });
    await deps.pickerCache.set(cacheKey, entries, deps.config.pickerCacheTtlSeconds);
  }

  // Optional inline search (applied after cache; never filters out the pin unless
  // it also fails the term — matches the "inline filter" UX).
  if (query.search && query.search.trim() !== '') {
    const term = query.search.trim();
    entries = entries.filter((h) => matchesSearch(h, term));
  }

  deps.logger.info('hospital.picker', {
    userId: principal.userId,
    sourceDoctorId: sourceDoctorId || null,
    count: entries.length,
  });

  return { hospitals: entries };
}

/** GET /hospitals/{id} — hospital detail (any authenticated role). */
export async function getHospitalDetail(
  deps: HospitalDeps,
  principal: Principal,
  id: string
): Promise<HospitalSummary> {
  const hospital = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(sessionContext(principal));
    return repo.getHospitalById(id);
  });
  if (!hospital) {
    throw new AppError('NOT_FOUND', 'Hospital not found');
  }
  return hospital;
}

/** GET /doctors/me/affiliations — the doctor's own affiliations (H-05). */
export async function getMyAffiliations(
  deps: HospitalDeps,
  principal: Principal
): Promise<{ affiliations: AffiliationView[] }> {
  if (principal.role !== 'doctor') {
    throw new AppError('FORBIDDEN', 'Only a doctor may view affiliations');
  }
  const affiliations = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(sessionContext(principal));
    return repo.listDoctorAffiliations(principal.userId);
  });
  return { affiliations };
}
