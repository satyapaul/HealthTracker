/**
 * Admin hospital-registry business logic (WP 3.2 — spec §7.0.3 H-01/H-02/H-03/H-09).
 *
 * Guards (LLD §3.8.1):
 *  - The Virtual Hospital (well-known UUID) is non-editable / non-deactivatable;
 *    admins also cannot CREATE a `virtual`-type hospital or reuse the reserved
 *    `VIRTUAL` code.
 *  - id and hospital_code are immutable on edit (column whitelist).
 *  - Non-virtual hospitals require address/city/country.
 *
 * All operations run under the admin RLS context; the V8 policies are the
 * second gate.
 */
import { AppError } from '../envelope';
import type { AdminDeps } from '../deps';
import type { Principal } from '../http';
import type {
  HospitalRecord,
  HospitalType,
  HospitalStatus,
  NewHospitalInput,
  HospitalUpdateInput,
  SessionContext,
} from '../ports/db';

/** The system-seeded Virtual Hospital's well-known UUID. */
export const VIRTUAL_HOSPITAL_ID = '00000000-0000-0000-0000-000000000000';
const RESERVED_CODE = 'VIRTUAL';
const MAX_CODE_LEN = 20;
const HOSPITAL_TYPES: readonly HospitalType[] = [
  'general',
  'specialty',
  'clinic',
  'daycare',
  'virtual',
];

function adminContext(principal: Principal): SessionContext {
  return { userId: principal.userId, role: 'admin', patientId: null };
}

function assertHospitalType(value: string): HospitalType {
  if (!(HOSPITAL_TYPES as readonly string[]).includes(value)) {
    throw new AppError('VALIDATION_ERROR', "Field 'hospitalType' is invalid", {
      field: 'hospitalType',
    });
  }
  return value as HospitalType;
}

export interface CreateHospitalCommand {
  hospitalCode: string;
  hospitalName: string;
  hospitalType: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  phone?: string;
  websiteUrl?: string;
  logoUrl?: string;
}

/** H-01: create a hospital. Admins cannot create virtual hospitals. */
export async function createHospital(
  deps: AdminDeps,
  principal: Principal,
  cmd: CreateHospitalCommand
): Promise<HospitalRecord> {
  const code = cmd.hospitalCode.trim();
  if (code.length === 0 || code.length > MAX_CODE_LEN) {
    throw new AppError('VALIDATION_ERROR', 'hospitalCode must be 1-20 characters', {
      field: 'hospitalCode',
    });
  }
  if (code.toUpperCase() === RESERVED_CODE) {
    throw new AppError('VALIDATION_ERROR', 'hospitalCode VIRTUAL is reserved', {
      field: 'hospitalCode',
    });
  }
  const type = assertHospitalType(cmd.hospitalType);
  if (type === 'virtual') {
    throw new AppError('VALIDATION_ERROR', 'Cannot create a virtual hospital', {
      field: 'hospitalType',
    });
  }
  // Non-virtual hospitals require a physical address.
  if (!cmd.addressLine1 || !cmd.city || !cmd.country) {
    throw new AppError('VALIDATION_ERROR', 'address, city, and country are required', {
      field: 'address',
    });
  }

  const input: NewHospitalInput = {
    id: deps.ids.uuid(),
    hospitalCode: code,
    hospitalName: cmd.hospitalName,
    hospitalType: type,
    addressLine1: cmd.addressLine1,
    addressLine2: cmd.addressLine2 ?? null,
    city: cmd.city,
    state: cmd.state ?? null,
    country: cmd.country,
    postalCode: cmd.postalCode ?? null,
    phone: cmd.phone ?? null,
    websiteUrl: cmd.websiteUrl ?? null,
    logoUrl: cmd.logoUrl ?? null,
    createdBy: principal.userId,
  };

  const ctx = adminContext(principal);
  const hospital = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    if (await repo.getHospitalByCode(code)) {
      throw new AppError('CONFLICT', 'A hospital with this code already exists', {
        field: 'hospitalCode',
      });
    }
    return repo.createHospital(input);
  });

  deps.logger.info('admin.hospital.created', {
    hospitalId: hospital.id,
    userId: principal.userId,
  });
  return hospital;
}

export interface UpdateHospitalCommand {
  hospitalName?: string;
  hospitalType?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  phone?: string;
  websiteUrl?: string;
  logoUrl?: string;
}

/** H-02: edit a hospital. id/hospital_code are immutable; Virtual is read-only. */
export async function updateHospital(
  deps: AdminDeps,
  principal: Principal,
  id: string,
  cmd: UpdateHospitalCommand
): Promise<HospitalRecord> {
  if (id === VIRTUAL_HOSPITAL_ID) {
    throw new AppError('FORBIDDEN', 'The Virtual Hospital cannot be edited');
  }

  const update: HospitalUpdateInput = {};
  if (cmd.hospitalName !== undefined) update.hospitalName = cmd.hospitalName;
  if (cmd.hospitalType !== undefined) update.hospitalType = assertHospitalType(cmd.hospitalType);
  if (cmd.addressLine1 !== undefined) update.addressLine1 = cmd.addressLine1;
  if (cmd.addressLine2 !== undefined) update.addressLine2 = cmd.addressLine2;
  if (cmd.city !== undefined) update.city = cmd.city;
  if (cmd.state !== undefined) update.state = cmd.state;
  if (cmd.country !== undefined) update.country = cmd.country;
  if (cmd.postalCode !== undefined) update.postalCode = cmd.postalCode;
  if (cmd.phone !== undefined) update.phone = cmd.phone;
  if (cmd.websiteUrl !== undefined) update.websiteUrl = cmd.websiteUrl;
  if (cmd.logoUrl !== undefined) update.logoUrl = cmd.logoUrl;

  if (Object.keys(update).length === 0) {
    throw new AppError('VALIDATION_ERROR', 'No updatable fields were provided');
  }

  const ctx = adminContext(principal);
  const hospital = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    return repo.updateHospital(id, update);
  });
  if (!hospital) {
    throw new AppError('NOT_FOUND', 'Hospital not found');
  }

  deps.logger.info('admin.hospital.updated', { hospitalId: id, userId: principal.userId });
  return hospital;
}

/** H-03: deactivate/reactivate a hospital. Virtual cannot change status. */
export async function setHospitalStatus(
  deps: AdminDeps,
  principal: Principal,
  id: string,
  status: HospitalStatus
): Promise<HospitalRecord> {
  if (id === VIRTUAL_HOSPITAL_ID) {
    throw new AppError('FORBIDDEN', 'The Virtual Hospital cannot be deactivated');
  }
  const ctx = adminContext(principal);
  const hospital = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    return repo.setHospitalStatus(id, status);
  });
  if (!hospital) {
    throw new AppError('NOT_FOUND', 'Hospital not found');
  }
  deps.logger.info('admin.hospital.status', {
    hospitalId: id,
    status,
    userId: principal.userId,
  });
  return hospital;
}

export interface SearchHospitalsCommand {
  search?: string;
  type?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

/** H-09: search hospitals (name/code/city, type, status) with pagination. */
export async function searchHospitals(
  deps: AdminDeps,
  principal: Principal,
  cmd: SearchHospitalsCommand
): Promise<{ hospitals: HospitalRecord[]; page: number; pageSize: number }> {
  const page = cmd.page && cmd.page > 0 ? Math.floor(cmd.page) : 1;
  const requested =
    cmd.pageSize && cmd.pageSize > 0 ? Math.floor(cmd.pageSize) : deps.config.defaultPageSize;
  const pageSize = Math.min(requested, deps.config.maxPageSize);

  const type = cmd.type !== undefined ? assertHospitalType(cmd.type) : undefined;
  let status: HospitalStatus | undefined;
  if (cmd.status !== undefined) {
    if (cmd.status !== 'active' && cmd.status !== 'inactive') {
      throw new AppError('VALIDATION_ERROR', "Field 'status' is invalid", { field: 'status' });
    }
    status = cmd.status;
  }

  const ctx = adminContext(principal);
  const hospitals = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext(ctx);
    return repo.searchHospitals({
      search: cmd.search,
      type,
      status,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
  });

  return { hospitals, page, pageSize };
}
