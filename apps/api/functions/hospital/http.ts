/**
 * Thin HTTP request shape + helpers for the hospital domain. These routes sit
 * behind the WP 1.2 authorizer; the principal is read from the authorizer
 * context.
 */
import { AppError } from './envelope';

export type UserRole = 'patient' | 'caregiver' | 'doctor' | 'admin';

export interface Principal {
  userId: string;
  role: UserRole;
  patientId?: string | null;
}

export interface HospitalRequest {
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

/** Require an authenticated principal with a recognized role, else 401. */
export function requirePrincipal(req: HospitalRequest): Principal {
  const p = req.principal;
  if (!p || typeof p.userId !== 'string' || p.userId.length === 0 || !isUserRole(p.role)) {
    throw new AppError('UNAUTHENTICATED', 'Authentication required');
  }
  return p;
}
