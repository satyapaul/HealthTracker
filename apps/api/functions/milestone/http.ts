/**
 * Thin HTTP request shape + helpers for the milestone domain (doctor-facing
 * create/list). Behind the WP 1.2 authorizer; principal read from context.
 */
import { AppError } from './envelope';

export type UserRole = 'patient' | 'caregiver' | 'doctor' | 'admin';

export interface Principal {
  userId: string;
  role: UserRole;
  patientId?: string | null;
}

export interface MilestoneRequest {
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

export function requirePrincipal(req: MilestoneRequest): Principal {
  const p = req.principal;
  if (!p || typeof p.userId !== 'string' || p.userId.length === 0 || !isUserRole(p.role)) {
    throw new AppError('UNAUTHENTICATED', 'Authentication required');
  }
  return p;
}

export function parseJsonBody(req: MilestoneRequest): Record<string, unknown> {
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

export function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError('VALIDATION_ERROR', `Field '${field}' is required`, { field });
  }
  return value.trim();
}

export function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new AppError('VALIDATION_ERROR', `Field '${field}' must be a string`, { field });
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
