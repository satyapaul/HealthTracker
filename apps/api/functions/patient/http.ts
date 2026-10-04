/**
 * Thin HTTP request shape decoupled from API Gateway, plus parsing/validation
 * helpers for the patient domain.
 *
 * The patient routes sit BEHIND the WP 1.2 request authorizer, which attaches
 * the authenticated principal ({ userId, role, patientId }) to the request
 * context. We read it from there — handlers never trust a client-supplied
 * identity. `patientId` is '' when there is no linked patient (doctor/admin).
 */
import { AppError } from './envelope';

export type UserRole = 'patient' | 'caregiver' | 'doctor' | 'admin';

/** Authenticated principal, as produced by the WP 1.2 authorizer context. */
export interface Principal {
  userId: string;
  role: UserRole;
  /** '' / undefined for doctor/admin; a non-empty id for patient/caregiver. */
  patientId?: string | null;
}

export interface PatientRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: string | null;
  /** Principal injected by the authorizer (null if somehow absent). */
  principal: Principal | null;
  /** Path parameters (e.g. { id } for /patients/{id}). */
  pathParams: Record<string, string | undefined>;
  /** Query-string parameters (e.g. { hospital_id } for the dashboard filter). */
  query: Record<string, string | undefined>;
}

const VALID_ROLES: readonly UserRole[] = ['patient', 'caregiver', 'doctor', 'admin'];

function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (VALID_ROLES as readonly string[]).includes(value);
}

/**
 * Require an authenticated principal with a recognized role. The authorizer
 * should guarantee this, but we fail closed with UNAUTHENTICATED if the context
 * is missing or malformed.
 */
export function requirePrincipal(req: PatientRequest): Principal {
  const p = req.principal;
  if (!p || typeof p.userId !== 'string' || p.userId.length === 0 || !isUserRole(p.role)) {
    throw new AppError('UNAUTHENTICATED', 'Authentication required');
  }
  return p;
}

/** Parse and return the JSON body as a record, or throw VALIDATION_ERROR. */
export function parseJsonBody(req: PatientRequest): Record<string, unknown> {
  if (!req.body) {
    throw new AppError('VALIDATION_ERROR', 'Request body is required');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(req.body);
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Request body must be valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AppError('VALIDATION_ERROR', 'Request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/** Require a non-empty string field, else VALIDATION_ERROR. */
export function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError('VALIDATION_ERROR', `Field '${field}' is required`, { field });
  }
  return value.trim();
}

/** Optional string field: returns trimmed string, or undefined if absent/null. */
export function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new AppError('VALIDATION_ERROR', `Field '${field}' must be a string`, { field });
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Optional number field (accepts number or numeric string); undefined if absent. */
export function optionalNumber(body: Record<string, unknown>, field: string): number | undefined {
  const value = body[field];
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new AppError('VALIDATION_ERROR', `Field '${field}' must be a number`, { field });
  }
  return n;
}

/** Optional boolean field; undefined if absent. */
export function optionalBoolean(body: Record<string, unknown>, field: string): boolean | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw new AppError('VALIDATION_ERROR', `Field '${field}' must be a boolean`, { field });
  }
  return value;
}
