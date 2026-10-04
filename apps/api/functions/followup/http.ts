/**
 * Thin HTTP request shape decoupled from API Gateway, plus parsing/validation
 * helpers for the followup domain. These routes sit behind the WP 1.2
 * authorizer, which attaches the principal ({ userId, role, patientId }) to the
 * request context. `patientId` is '' when there is no linked patient.
 */
import { AppError } from './envelope';

export type UserRole = 'patient' | 'caregiver' | 'doctor' | 'admin';

export interface Principal {
  userId: string;
  role: UserRole;
  /** '' / undefined for doctor/admin; a non-empty id for patient/caregiver. */
  patientId?: string | null;
}

export interface FollowupRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: string | null;
  principal: Principal | null;
  /** Path parameters (e.g. { id } for /followup/rows/{id}). */
  pathParams: Record<string, string | undefined>;
  /** Query-string parameters (e.g. { patientId }). */
  query: Record<string, string | undefined>;
}

const VALID_ROLES: readonly UserRole[] = ['patient', 'caregiver', 'doctor', 'admin'];

function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (VALID_ROLES as readonly string[]).includes(value);
}

/** Require an authenticated principal with a recognized role, else 401. */
export function requirePrincipal(req: FollowupRequest): Principal {
  const p = req.principal;
  if (!p || typeof p.userId !== 'string' || p.userId.length === 0 || !isUserRole(p.role)) {
    throw new AppError('UNAUTHENTICATED', 'Authentication required');
  }
  return p;
}

/** Parse and return the JSON body as a record, or throw VALIDATION_ERROR. */
export function parseJsonBody(req: FollowupRequest): Record<string, unknown> {
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

/** Optional string field: trimmed string, or undefined if absent/empty. */
export function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new AppError('VALIDATION_ERROR', `Field '${field}' must be a string`, { field });
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Optional number field (number or numeric string); undefined if absent. */
export function optionalNumber(body: Record<string, unknown>, field: string): number | undefined {
  const value = body[field];
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new AppError('VALIDATION_ERROR', `Field '${field}' must be a number`, { field });
  }
  return n;
}
