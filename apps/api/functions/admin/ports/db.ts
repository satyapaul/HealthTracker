/**
 * Database port for the admin domain (WP 3.2 — hospital registry management).
 *
 * All writes run under the RLS context (role='admin'); the V8 §2.10/§2.11
 * policies are the second gate. Parameterized queries only; the concrete
 * adapter is faked in unit tests.
 */

export type UserRole = 'patient' | 'caregiver' | 'doctor' | 'admin';
export type HospitalType = 'general' | 'specialty' | 'clinic' | 'daycare' | 'virtual';
export type HospitalStatus = 'active' | 'inactive';
export type AffiliationStatus = 'active' | 'inactive';

export interface SessionContext {
  userId: string;
  role: UserRole;
  patientId?: string | null;
}

export interface HospitalRecord {
  id: string;
  hospitalCode: string;
  hospitalName: string;
  hospitalType: HospitalType;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  phone: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  status: HospitalStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewHospitalInput {
  id: string;
  hospitalCode: string;
  hospitalName: string;
  hospitalType: HospitalType;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  websiteUrl?: string | null;
  logoUrl?: string | null;
  createdBy: string;
}

/** Mutable hospital fields (id + hospital_code are immutable, H-02). */
export interface HospitalUpdateInput {
  hospitalName?: string;
  hospitalType?: HospitalType;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  websiteUrl?: string | null;
  logoUrl?: string | null;
}

export interface HospitalSearchQuery {
  search?: string; // matches name / code / city
  type?: HospitalType;
  status?: HospitalStatus;
  limit: number;
  offset: number;
}

export interface AffiliationRecord {
  id: string;
  doctorId: string;
  hospitalId: string;
  roleAtHospital: string | null;
  isPrimary: boolean;
  status: AffiliationStatus;
  grantedBy: string;
  grantedAt: string;
}

export interface NewAffiliationInput {
  id: string;
  doctorId: string;
  hospitalId: string;
  roleAtHospital: string | null;
  isPrimary: boolean;
  grantedBy: string;
}

export interface AffiliationUpdateInput {
  roleAtHospital?: string | null;
  isPrimary?: boolean;
  status?: AffiliationStatus;
}

/** Transaction-scoped admin repository. */
export interface AdminRepository {
  setSessionContext(ctx: SessionContext): Promise<void>;

  // ── Hospitals ──────────────────────────────────────────────────────────────
  getHospitalById(id: string): Promise<HospitalRecord | null>;
  getHospitalByCode(code: string): Promise<HospitalRecord | null>;
  createHospital(input: NewHospitalInput): Promise<HospitalRecord>;
  updateHospital(id: string, input: HospitalUpdateInput): Promise<HospitalRecord | null>;
  setHospitalStatus(id: string, status: HospitalStatus): Promise<HospitalRecord | null>;
  searchHospitals(q: HospitalSearchQuery): Promise<HospitalRecord[]>;

  // ── Affiliations ─────────────────────────────────────────────────────────────
  /** Role of a user by id, or null if the user doesn't exist. */
  getUserRole(userId: string): Promise<UserRole | null>;
  findAffiliation(doctorId: string, hospitalId: string): Promise<AffiliationRecord | null>;
  getAffiliationById(id: string): Promise<AffiliationRecord | null>;
  /** True if the doctor already has an active primary affiliation. */
  hasPrimaryAffiliation(doctorId: string): Promise<boolean>;
  addAffiliation(input: NewAffiliationInput): Promise<AffiliationRecord>;
  updateAffiliation(id: string, input: AffiliationUpdateInput): Promise<AffiliationRecord | null>;
}

/** DB port entrypoint: run work inside a single transaction. */
export interface DbPort {
  transaction<T>(fn: (repo: AdminRepository) => Promise<T>): Promise<T>;
}
