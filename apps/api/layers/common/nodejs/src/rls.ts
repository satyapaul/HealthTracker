/**
 * Reusable PostgreSQL Row-Level Security (RLS) session-context helper — WP 1.3.
 *
 * PostgreSQL RLS policies (LLD §2) read three transaction-local settings on
 * every user-scoped query:
 *   - `app.current_user_id`
 *   - `app.current_role`
 *   - `app.current_patient_id`
 *
 * These are derived from the authenticated principal that the WP 1.2 authorizer
 * produces (`{ userId, role, patientId }`, where `patientId` is `''` when there
 * is no linked patient). This module is the single, safe, reusable way to apply
 * that context.
 *
 * SECURITY (non-negotiable):
 *  - Values are ONLY ever bound as query parameters via `set_config(name, value,
 *    true)`. We NEVER string-interpolate a value into the SQL text — that would
 *    be an injection surface. The `name` argument is a fixed literal.
 *  - `set_config(..., true)` sets the value LOCAL to the current transaction, so
 *    it is automatically cleared at COMMIT/ROLLBACK — no leakage across pooled
 *    connections (important behind RDS Proxy).
 *  - No PHI is placed in error messages or logs; only opaque enum/role info.
 */

/** The four principal roles RLS distinguishes. */
export type UserRole = 'patient' | 'caregiver' | 'doctor' | 'admin';

/** Normalized, validated principal context ready to apply to a DB session. */
export interface RlsContext {
  userId: string;
  role: UserRole;
  /** null for doctor/admin; a non-empty id for patient/caregiver. */
  patientId?: string | null;
}

/**
 * Minimal structural interface for a DB query runner. The concrete `pg` client
 * (or a pooled connection) satisfies this; keeping it structural means tests can
 * inject a fake and we never import `pg` here (the layer stays dependency-free).
 */
export interface QueryRunner {
  query(sql: string, params: unknown[]): Promise<unknown>;
}

/** Stable error codes emitted by this module. */
export type RlsContextErrorCode = 'RLS_CONTEXT_INVALID';

/**
 * Typed validation error. Carries a stable `code` for mapping to the API error
 * envelope at the handler edge. Messages are PHI-free by construction.
 */
export class RlsContextError extends Error {
  readonly code: RlsContextErrorCode;

  constructor(message: string, code: RlsContextErrorCode = 'RLS_CONTEXT_INVALID') {
    super(message);
    this.name = 'RlsContextError';
    this.code = code;
    // Restore prototype chain for instanceof across transpile targets.
    Object.setPrototypeOf(this, RlsContextError.prototype);
  }
}

const VALID_ROLES: readonly UserRole[] = ['patient', 'caregiver', 'doctor', 'admin'];

function isUserRole(value: string): value is UserRole {
  return (VALID_ROLES as readonly string[]).includes(value);
}

/**
 * Validate and normalize the raw authorizer context into an `RlsContext`.
 *
 * Rules:
 *  - `userId` must be a non-empty string.
 *  - `role` must be one of the four enum values (else throw).
 *  - For `patient` / `caregiver`: a non-empty `patientId` is REQUIRED. These
 *    roles are meaningless without a patient scope and RLS depends on it — a
 *    missing/null/'' patientId throws.
 *  - For `doctor` / `admin`: `patientId` is forced to null. Any provided value
 *    is ignored/forbidden so a doctor can't spoof a patient scope.
 *
 * The authorizer represents "no linked patient" as `''`; we normalize `''` to
 * null here.
 */
export function normalizeAuthorizerContext(raw: {
  userId?: string;
  role?: string;
  patientId?: string | null;
}): RlsContext {
  const userId = raw.userId;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new RlsContextError('userId is required');
  }

  const role = raw.role;
  if (typeof role !== 'string' || !isUserRole(role)) {
    throw new RlsContextError('role is not a recognized value');
  }

  // Treat '' (the authorizer's "no linked patient") the same as null/undefined.
  const rawPatientId =
    typeof raw.patientId === 'string' && raw.patientId.length > 0 ? raw.patientId : null;

  if (role === 'patient' || role === 'caregiver') {
    if (rawPatientId === null) {
      throw new RlsContextError('patientId is required for patient/caregiver roles');
    }
    return { userId, role, patientId: rawPatientId };
  }

  // doctor / admin: forbid a patient scope — always null.
  return { userId, role, patientId: null };
}

/**
 * Apply the RLS context to the current DB session by issuing exactly three
 * parameterized `set_config` calls. Values are bound as parameters — never
 * interpolated into the SQL string.
 *
 * `set_config(name, value, true)` scopes each setting to the current transaction
 * (`true` = is_local), so callers MUST invoke this inside a transaction (see
 * {@link withRlsContext}). A null patientId is sent as `''`; RLS policies only
 * cast `app.current_patient_id` to UUID for patient/caregiver, where it is
 * guaranteed present.
 */
export async function applyRlsContext(runner: QueryRunner, ctx: RlsContext): Promise<void> {
  await runner.query("SELECT set_config('app.current_user_id', $1, true)", [ctx.userId]);
  await runner.query("SELECT set_config('app.current_role', $1, true)", [ctx.role]);
  await runner.query("SELECT set_config('app.current_patient_id', $1, true)", [
    ctx.patientId ?? '',
  ]);
}

/**
 * Run `fn` inside a transaction with the RLS context applied.
 *
 * Sequence: BEGIN -> applyRlsContext -> fn() -> COMMIT. On any error, ROLLBACK
 * and rethrow the original error. Because the settings are transaction-local
 * (`set_config(..., true)`), they are automatically cleared at COMMIT/ROLLBACK —
 * nothing leaks onto the next use of a pooled connection.
 */
export async function withRlsContext<T>(
  runner: QueryRunner,
  ctx: RlsContext,
  fn: () => Promise<T>
): Promise<T> {
  await runner.query('BEGIN', []);
  try {
    await applyRlsContext(runner, ctx);
    const result = await fn();
    await runner.query('COMMIT', []);
    return result;
  } catch (err) {
    await runner.query('ROLLBACK', []);
    throw err;
  }
}
