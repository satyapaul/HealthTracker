/**
 * Session service: issue opaque session tokens, store in Redis + auth_sessions,
 * validate/revoke. session:{token} -> { userId, role, patientId? } (LLD §5.1).
 */
import type { AuthDeps } from '../deps';
import type { AuthRepository, UserRecord } from '../ports/db';
import { AppError } from '../envelope';

export interface SessionPayload {
  userId: string;
  role: UserRecord['role'];
  patientId: string | null;
}

export interface IssuedSession {
  sessionToken: string;
  expiresAt: string;
}

export function sessionKey(token: string): string {
  return `session:${token}`;
}

/**
 * Issue a session for a user inside an open transaction: generate an opaque
 * token, SET Redis session:{token} with the configured TTL, and INSERT an
 * auth_sessions row.
 */
export async function issueSession(
  deps: AuthDeps,
  repo: AuthRepository,
  user: UserRecord
): Promise<IssuedSession> {
  const token = deps.ids.sessionToken();
  const now = deps.clock.now();
  const expiresAt = new Date(now.getTime() + deps.config.sessionTtlSeconds * 1000);

  const payload: SessionPayload = {
    userId: user.id,
    role: user.role,
    patientId: user.linkedPatientId ?? null,
  };

  await deps.redis.set(sessionKey(token), JSON.stringify(payload), deps.config.sessionTtlSeconds);
  await repo.createSession({ id: deps.ids.uuid(), userId: user.id, expiresAt });

  return { sessionToken: token, expiresAt: expiresAt.toISOString() };
}

/** Resolve the payload for a session token from Redis, or throw UNAUTHENTICATED. */
export async function requireSession(
  deps: AuthDeps,
  token: string | null
): Promise<SessionPayload> {
  if (!token) {
    throw new AppError('UNAUTHENTICATED', 'Missing or invalid session token');
  }
  const raw = await deps.redis.get(sessionKey(token));
  if (!raw) {
    throw new AppError('UNAUTHENTICATED', 'Session expired or revoked');
  }
  return JSON.parse(raw) as SessionPayload;
}
