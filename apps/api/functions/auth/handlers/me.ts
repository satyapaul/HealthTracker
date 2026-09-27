/**
 * GET /auth/me — return the authenticated user's profile.
 * Invalid/absent session -> UNAUTHENTICATED (401).
 */
import type { AuthDeps } from '../deps';
import type { AuthRequest } from '../http';
import { AppError, respondOk, type HttpResponse } from '../envelope';
import { extractBearerToken } from '../http';
import { requireSession } from '../services/session';

export async function handleGetMe(deps: AuthDeps, req: AuthRequest): Promise<HttpResponse> {
  const token = extractBearerToken(req.headers);
  const payload = await requireSession(deps, token);

  const user = await deps.db.transaction(async (repo) => {
    await repo.setSessionContext({
      userId: payload.userId,
      role: payload.role,
      patientId: payload.patientId,
    });
    return repo.findUserById(payload.userId);
  });

  if (!user) {
    // Session references a user that no longer exists.
    throw new AppError('UNAUTHENTICATED', 'Session user not found');
  }

  return respondOk({
    id: user.id,
    role: user.role,
    displayName: user.displayName,
    email: user.email,
    status: user.status,
    linkedPatientId: user.linkedPatientId,
  });
}
