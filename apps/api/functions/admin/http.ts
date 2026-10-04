/**
 * Thin HTTP request shape + parsing/validation helpers for the admin domain.
 * These routes sit behind the WP 1.2 authorizer; the principal is read from the
 * authorizer context and every route requires role 'admin'.
 */
import { AppError } from './envelope';

export type UserRole = 'patient' | 'caregiver' | 'doctor' | 'admin';

export interface Principal {
  userId: string;
  role: UserRole;
  patientId?: string | null;
}

export interface AdminRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: string | null;
  principal: Principal | null;
  pathParams: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
}

const VALID_ROLES: readonly UserRole[] = ['patient', 'caregiver', 'doctor', 'admin'];

function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (VALID_ROLES as readonly string[]).includes(value);
}

/** Require an authenticated admin principal, else 401 / 403. */
export function requireAdmin(req: AdminRequest): Principal {
  const p = req.principal;
  if (!p || typeof p.userId !== 'string' || p.userId.length === 0 || !isUserRole(p.role)) {
    throw new AppError('UNAUTHENTICATED', 'Authentication required');
  }
  if (p.role !== 'admin') {
    throw new AppError('FORBIDDEN', 'Admin role required');
  }
  return p;
}

/** Parse and return the JSON body as a record, or throw VALIDATION_ERROR. */
export function parseJsonBody(req: AdminRequest): Record<string, unknown> {
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

/** Optional string: trimmed, or undefined if absent/empty. */
export function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new AppError('VALIDATION_ERROR', `Field '${field}' must be a string`, { field });
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Optional boolean; undefined if absent. */
export function optionalBoolean(body: Record<string, unknown>, field: string): boolean | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw new AppError('VALIDATION_ERROR', `Field '${field}' must be a boolean`, { field });
  }
  return value;
}
