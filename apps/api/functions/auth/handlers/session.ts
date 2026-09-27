/**
 * DELETE /auth/session — revoke the caller's session.
 * Sets auth_sessions.revoked_at and deletes the Redis session key. 204 on
 * success; absent/expired session -> UNAUTHENTICATED (401).
 */
import type { AuthDeps } from '../deps';
import type { AuthRequest } from '../http';
import { respondNoContent, type HttpResponse } from '../envelope';
import { extractBearerToken } from '../http';
import { requireSession, sessionKey } from '../services/session';

export async function handleDeleteSession(deps: AuthDeps, req: AuthRequest): Promise<HttpResponse> {
  const token = extractBearerToken(req.headers);
  const payload = await requireSession(deps, token);

  await deps.db.transaction(async (repo) => {
    await repo.setSessionContext({
      userId: payload.userId,
      role: payload.role,
      patientId: payload.patientId,
    });
    await repo.revokeSessionsForUser(payload.userId, deps.clock.now());
  });

  await deps.redis.del(sessionKey(token as string));

  await deps.audit.write({
    eventType: 'AUTH_LOGOUT',
    userId: payload.userId,
    occurredAt: deps.clock.now().toISOString(),
  });

  deps.logger.info('auth.logout', { userId: payload.userId });

  return respondNoContent();
}
