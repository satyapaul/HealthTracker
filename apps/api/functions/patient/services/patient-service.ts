/**
 * Patient chart business logic (WP 2.1 — spec §7.1).
 *
 * Responsibilities:
 *  - Validate the chart-header field catalog (required vs optional, §7.1).
 *  - Apply the default-follow-up-hospital rule: when unset, it defaults to the
 *    procedure hospital (spec §7.1).
 *  - Enforce API-layer authorization (admin onboards/manages; patient/caregiver
 *    read/update their own chart). DB-layer RLS (V4) is the second gate.
 *  - Map between the API payload (camelCase) and the repository record.
 *
 * No PHI is logged or placed in error messages. All reads/writes run inside a
 * transaction with the RLS session context set first.
 */
import { AppError } from '../envelope';
import type { PatientDeps } from '../deps';
import type { Principal } from '../http';
import type {
  NewPatientInput,
  PatientRecord,
  PatientUpdateInput,
  ReminderPreferences,
  SessionContext,
} from '../ports/db';

/** Public (API) view of a chart. Same shape as the record; explicit for clarity. */
export type PatientView = PatientRecord;

const DEFAULT_REMINDER_PREFS: ReminderPreferences = {
  smsEnabled: true,
  whatsappEnabled: true,
  timezone: 'Asia/Kolkata',
};

/** Build the RLS session context for the current principal. */
function sessionContextFor(principal: Principal): SessionContext {
  if (principal.role === 'patient' || principal.role === 'caregiver') {
    // RLS requires a patient scope for these roles; the authorizer guarantees it.
    const patientId =
      typeof principal.patientId === 'string' && principal.patientId.length > 0
        ? principal.patientId
        : null;
    if (patientId === null) {
      throw new AppError('FORBIDDEN', 'No patient is linked to this account');
    }
    return { userId: principal.userId, role: principal.role, patientId };
  }
  // doctor / admin: no patient scope.
  return { userId: principal.userId, role: principal.role, patientId: null };
}

/**
 * Create input shape, pre-validated at the handler boundary and normalized here.
 * Required header fields (spec §7.1): name, age, sex, maxId, dateOfOperation,
 * diagnosis, histopathology, anastomosisType, contactEmail, procedureHospitalId.
 * (Primary doctor / care team authorization is modeled in later phases; the
 * primaryDoctorId column is accepted here but not required by WP 2.1.)
 */
export interface CreatePatientCommand {
  name: string;
  ageYears?: number;
  sex?: string;
  maxId: string;
  photoUrl?: string;
  dateOfOperation?: string;
  diagnosis?: string;
  histopathology?: string;
  anastomosisType?: string;
  contactEmail?: string;
  phoneNumber?: string;
  whatsappNumber?: string;
  reminderPreferences?: ReminderPreferences;
  reminderOptOut?: boolean;
  procedureHospitalId?: string;
  defaultFollowupHospitalId?: string;
  primaryDoctorId?: string;
}

const SEX_VALUES = new Set(['M', 'F', 'O']);

function assertSex(sex: string | undefined): 'M' | 'F' | 'O' {
  if (!sex || !SEX_VALUES.has(sex)) {
    throw new AppError('VALIDATION_ERROR', "Field 'sex' must be one of M, F, O", { field: 'sex' });
  }
  return sex as 'M' | 'F' | 'O';
}

function assertRequired(value: string | undefined, field: string): string {
  if (value === undefined || value.length === 0) {
    throw new AppError('VALIDATION_ERROR', `Field '${field}' is required`, { field });
  }
  return value;
}

/**
 * Create a patient chart. Only admins may onboard charts (spec §: Admin
 * onboards patients). Enforces the §7.1 required-field catalog and the
 * default-follow-up-hospital rule.
 */
export async function createPatient(
  deps: PatientDeps,
  principal: Principal,
  cmd: CreatePatientCommand
): Promise<PatientView> {
  if (principal.role !== 'admin') {
    throw new AppError('FORBIDDEN', 'Only an admin may create a patient chart');
  }

  // Required header fields (spec §7.1).
  const name = assertRequired(cmd.name, 'name');
  const maxId = assertRequired(cmd.maxId, 'maxId');
  const sex = assertSex(cmd.sex);
  if (cmd.ageYears === undefined) {
    throw new AppError('VALIDATION_ERROR', "Field 'ageYears' is required", { field: 'ageYears' });
  }
  const dateOfOperation = assertRequired(cmd.dateOfOperation, 'dateOfOperation');
  const diagnosis = assertRequired(cmd.diagnosis, 'diagnosis');
  const histopathology = assertRequired(cmd.histopathology, 'histopathology');
  const anastomosisType = assertRequired(cmd.anastomosisType, 'anastomosisType');
  const contactEmail = assertRequired(cmd.contactEmail, 'contactEmail');
  const procedureHospitalId = assertRequired(cmd.procedureHospitalId, 'procedureHospitalId');

  // Default-follow-up-hospital rule (spec §7.1): defaults to procedure hospital
  // when the client does not supply one.
  const defaultFollowupHospitalId = cmd.defaultFollowupHospitalId ?? procedureHospitalId;

  const input: NewPatientInput = {
    id: deps.ids.uuid(),
    name,
    ageYears: cmd.ageYears,
    sex,
    maxId,
    photoUrl: cmd.photoUrl ?? null,
    dateOfOperation,
    diagnosis,
    histopathology,
    anastomosisType,
    contactEmail,
    phoneNumber: cmd.phoneNumber ?? null,
    whatsappNumber: cmd.whatsappNumber ?? null,
    reminderPreferences: cmd.reminderPreferences ?? DEFAULT_REMINDER_PREFS,
    reminderOptOut: cmd.reminderOptOut ?? false,
    procedureHospitalId,
    defaultFollowupHospitalId,
    primaryDoctorId: cmd.primaryDoctorId ?? null,
  };

  const ctx = sessionContextFor(principal);

  const record = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    // Pre-check for a friendly 409 (the UNIQUE constraint is the real guard).
    if (await repo.existsByMaxId(maxId)) {
      throw new AppError('CONFLICT', 'A chart with this record number already exists', {
        field: 'maxId',
      });
    }
    return repo.createPatient(input);
  });

  deps.logger.info('patient.chart.created', {
    patientId: record.id,
    actorRole: principal.role,
    userId: principal.userId,
  });

  return record;
}

/**
 * Read a chart by id. RLS scopes visibility; a chart the principal cannot see
 * surfaces as NOT_FOUND (we do not distinguish "exists but forbidden" to avoid
 * leaking existence of other patients' charts).
 */
export async function getPatientById(
  deps: PatientDeps,
  principal: Principal,
  id: string
): Promise<PatientView> {
  const ctx = sessionContextFor(principal);
  const record = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    return repo.findPatientById(id);
  });

  if (!record) {
    throw new AppError('NOT_FOUND', 'Patient chart not found');
  }

  deps.logger.info('patient.chart.read', {
    patientId: record.id,
    actorRole: principal.role,
    userId: principal.userId,
  });

  return record;
}

/** List charts visible to the principal (RLS-scoped). */
export async function listPatients(
  deps: PatientDeps,
  principal: Principal
): Promise<PatientView[]> {
  const ctx = sessionContextFor(principal);
  const records = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    return repo.listPatients();
  });

  deps.logger.info('patient.chart.list', {
    actorRole: principal.role,
    userId: principal.userId,
    count: records.length,
  });

  return records;
}

/** A doctor-dashboard entry: the chart plus pending-submission badge info. */
export interface DashboardEntry {
  patient: PatientView;
  pendingSubmissionCount: number;
  hasPending: boolean;
}

/**
 * Doctor dashboard (WP 3.4 — spec D-13): the doctor's assigned patients with
 * pending-submission badges, optionally filtered to patients with at least one
 * follow-up engagement at `hospitalId`. Doctor-only; RLS scopes to assigned
 * patients (V6 doctor-select policy).
 */
export async function listDoctorDashboard(
  deps: PatientDeps,
  principal: Principal,
  hospitalId: string | null
): Promise<DashboardEntry[]> {
  if (principal.role !== 'doctor') {
    throw new AppError('FORBIDDEN', 'The hospital-filtered dashboard is for doctors');
  }

  const ctx = sessionContextFor(principal);
  const rows = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    return repo.listDoctorDashboard(hospitalId);
  });

  deps.logger.info('patient.dashboard.list', {
    userId: principal.userId,
    hospitalFiltered: hospitalId !== null,
    count: rows.length,
  });

  return rows.map((r) => ({
    patient: r.patient,
    pendingSubmissionCount: r.pendingSubmissionCount,
    hasPending: r.hasPending,
  }));
}

/** Mutable fields accepted on update (handler pre-validates types). */
export interface UpdatePatientCommand {
  name?: string;
  ageYears?: number;
  sex?: string;
  photoUrl?: string;
  dateOfOperation?: string;
  diagnosis?: string;
  histopathology?: string;
  anastomosisType?: string;
  contactEmail?: string;
  phoneNumber?: string;
  whatsappNumber?: string;
  reminderPreferences?: ReminderPreferences;
  reminderOptOut?: boolean;
  procedureHospitalId?: string;
  defaultFollowupHospitalId?: string;
  primaryDoctorId?: string;
}

/**
 * Update a chart. patient/caregiver may update their own chart (RLS enforces
 * the row); admins may update any. Doctors are denied here (their write access
 * lands with the Phase 6 care-team model). Required fields that are present
 * must stay non-empty; omitted fields are left unchanged.
 */
export async function updatePatient(
  deps: PatientDeps,
  principal: Principal,
  id: string,
  cmd: UpdatePatientCommand
): Promise<PatientView> {
  if (principal.role === 'doctor') {
    throw new AppError('FORBIDDEN', 'Doctor chart edits are not available in this phase');
  }

  const update: PatientUpdateInput = {};
  if (cmd.name !== undefined) update.name = assertRequired(cmd.name, 'name');
  if (cmd.ageYears !== undefined) update.ageYears = cmd.ageYears;
  if (cmd.sex !== undefined) update.sex = assertSex(cmd.sex);
  if (cmd.photoUrl !== undefined) update.photoUrl = cmd.photoUrl;
  if (cmd.dateOfOperation !== undefined)
    update.dateOfOperation = assertRequired(cmd.dateOfOperation, 'dateOfOperation');
  if (cmd.diagnosis !== undefined) update.diagnosis = assertRequired(cmd.diagnosis, 'diagnosis');
  if (cmd.histopathology !== undefined)
    update.histopathology = assertRequired(cmd.histopathology, 'histopathology');
  if (cmd.anastomosisType !== undefined)
    update.anastomosisType = assertRequired(cmd.anastomosisType, 'anastomosisType');
  if (cmd.contactEmail !== undefined)
    update.contactEmail = assertRequired(cmd.contactEmail, 'contactEmail');
  if (cmd.phoneNumber !== undefined) update.phoneNumber = cmd.phoneNumber;
  if (cmd.whatsappNumber !== undefined) update.whatsappNumber = cmd.whatsappNumber;
  if (cmd.reminderPreferences !== undefined) update.reminderPreferences = cmd.reminderPreferences;
  if (cmd.reminderOptOut !== undefined) update.reminderOptOut = cmd.reminderOptOut;
  if (cmd.procedureHospitalId !== undefined)
    update.procedureHospitalId = assertRequired(cmd.procedureHospitalId, 'procedureHospitalId');
  if (cmd.defaultFollowupHospitalId !== undefined)
    update.defaultFollowupHospitalId = cmd.defaultFollowupHospitalId;
  if (cmd.primaryDoctorId !== undefined) update.primaryDoctorId = cmd.primaryDoctorId;

  if (Object.keys(update).length === 0) {
    throw new AppError('VALIDATION_ERROR', 'No updatable fields were provided');
  }

  const ctx = sessionContextFor(principal);
  const record = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    return repo.updatePatient(id, update);
  });

  if (!record) {
    // Either the chart does not exist or RLS hid it from this principal.
    throw new AppError('NOT_FOUND', 'Patient chart not found');
  }

  deps.logger.info('patient.chart.updated', {
    patientId: record.id,
    actorRole: principal.role,
    userId: principal.userId,
  });

  return record;
}
