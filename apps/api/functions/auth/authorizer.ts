/**
 * API Gateway v2 (HTTP API) request authorizer — WP 1.2.
 *
 * A SIMPLE Lambda authorizer (payloadFormatVersion 2.0, enableSimpleResponses)
 * that validates the opaque session token issued by WP 1.1 and attached via the
 * `Authorization: Bearer <token>` header. Sessions live in Redis under
 * `session:{token}` -> { userId, role, patientId }; revocation/expiry is simply
 * the Redis key being gone (see services/session.ts).
 *
 * Design notes:
 *  - Deny-by-default. A normal auth failure (missing/empty/invalid/expired/
 *    revoked token) returns { isAuthorized: false }. We NEVER throw for that —
 *    a thrown error becomes a 500 at API Gateway, not a clean 401/403.
 *  - We reuse requireSession/sessionKey from services/session.ts, catching the
 *    UNAUTHENTICATED AppError and translating it to a deny.
 *  - Authorizer context values must be strings. `patientId` may be null; we
 *    represent a null patientId as the empty string "" (documented choice, kept
 *    consistent so downstream handlers can treat "" as "no linked patient").
 *  - No token and no PHI (phone/email/name) ever enters the context or logs.
 *    userId/role are opaque identifiers and are safe to surface.
 */
import type { AuthDeps } from './deps';
import { buildDeps } from './factory';
import { AppError } from './envelope';
import { requireSession } from './services/session';

/**
 * Structural subset of an API Gateway v2 HTTP API authorizer (SIMPLE) event.
 * The token can arrive via `identitySource` (array, per the identitySource
 * config) and/or the raw `headers.authorization`. We support both defensively
 * without pulling in @types/aws-lambda (mirrors index.ts's approach).
 */
export interface AuthorizerEvent {
  type?: string;
  identitySource?: string[] | null;
  headers?: Record<string, string | undefined> | null;
  routeArn?: string;
}

/** SIMPLE-response shape. context values must be strings. */
export interface AuthorizerResult {
  isAuthorized: boolean;
  context?: Record<string, string>;
}

const DENY: AuthorizerResult = { isAuthorized: false };

/** Case-insensitive lookup of a header value. */
function getHeader(
  headers: Record<string, string | undefined> | null | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value ?? undefined;
  }
  return undefined;
}

/**
 * Extract the bearer token from the event. Prefers identitySource[0] (what the
 * configured identitySource `$request.header.Authorization` populates), falls
 * back to the Authorization header. Strips a case-insensitive `Bearer ` prefix.
 * Returns null when nothing usable is present.
 */
export function extractBearerToken(event: AuthorizerEvent): string | null {
  const fromIdentity =
    Array.isArray(event.identitySource) && event.identitySource.length > 0
      ? event.identitySource[0]
      : undefined;
  const raw = fromIdentity ?? getHeader(event.headers, 'authorization');
  if (!raw) return null;

  const trimmed = raw.trim();
  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  if (!match) return null;

  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/**
 * Core authorizer logic with injected deps (unit-testable). Never throws for a
 * normal auth failure — always resolves to allow/deny.
 */
export function authorizerWithDeps(deps: AuthDeps) {
  return async (event: AuthorizerEvent): Promise<AuthorizerResult> => {
    const token = extractBearerToken(event);
    if (!token) {
      deps.logger.info('auth.authorizer.decision', { allowed: false });
      return DENY;
    }

    try {
      const session = await requireSession(deps, token);
      // Authorizer context values must be strings. null patientId -> "".
      const context: Record<string, string> = {
        userId: session.userId,
        role: session.role,
        patientId: session.patientId ?? '',
      };
      deps.logger.info('auth.authorizer.decision', { allowed: true, userId: session.userId });
      return { isAuthorized: true, context };
    } catch (err) {
      // Expected: UNAUTHENTICATED -> deny. Anything unexpected also denies
      // (deny-by-default) rather than surfacing a 500 to callers.
      if (err instanceof AppError && err.code === 'UNAUTHENTICATED') {
        deps.logger.info('auth.authorizer.decision', { allowed: false });
      } else {
        deps.logger.error('auth.authorizer.error', { allowed: false });
      }
      return DENY;
    }
  };
}

/** Cached deps across warm invocations (mirrors index.ts). */
let cachedDeps: AuthDeps | undefined;

function getDeps(): AuthDeps {
  if (!cachedDeps) {
    cachedDeps = buildDeps(process.env);
  }
  return cachedDeps;
}

/** Lambda entry for the API Gateway request authorizer. */
export const authorizer = async (event: AuthorizerEvent): Promise<AuthorizerResult> => {
  return authorizerWithDeps(getDeps())(event);
};
