/**
 * Thin HTTP request shape decoupled from API Gateway, plus parsing helpers for
 * the dose domain. These routes sit behind the WP 1.2 authorizer, which
 * attaches the principal ({ userId, role, patientId }) to the request context.
 */
import { AppError } from './envelope';

export type UserRole = 'patient' | 'caregiver' | 'doctor' | 'admin';

export interface Principal {
  userId: string;
  role: UserRole;
  patientId?: string | null;
}

export interface DoseRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: string | null;
  principal: Principal | null;
  pathParams: Record<string, string | undefined>;
}

const VALID_ROLES: readonly UserRole[] = ['patient', 'caregiver', 'doctor', 'admin'];

function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (VALID_ROLES as readonly string[]).includes(value);
}

/** Require an authenticated principal with a recognized role, else 401. */
export function requirePrincipal(req: DoseRequest): Principal {
  const p = req.principal;
  if (!p || typeof p.userId !== 'string' || p.userId.length === 0 || !isUserRole(p.role)) {
    throw new AppError('UNAUTHENTICATED', 'Authentication required');
  }
  return p;
}

/** Parse and return the JSON body as a record, or throw VALIDATION_ERROR. */
export function parseJsonBody(req: DoseRequest): Record<string, unknown> {
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

/** Optional integer field; undefined if absent. */
export function optionalInt(body: Record<string, unknown>, field: string): number | undefined {
  const value = body[field];
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n)) {
    throw new AppError('VALIDATION_ERROR', `Field '${field}' must be an integer`, { field });
  }
  return n;
}
