/**
 * OAuth callback handlers: POST /auth/google/callback and POST /auth/x/callback.
 * Shared flow: CSRF state check -> provider exchange/verify -> find-or-create
 * user -> issue session -> audit. Response is the standard session shape.
 */
import { createHash } from 'node:crypto';
import type { AuthDeps } from '../deps';
import type { AuthRequest } from '../http';
import type { OAuthProfile } from '../ports/oauth';
import type { AuthEventType } from '../ports/audit';
import type { AuthProvider } from '../ports/db';
import { AppError, respondOk, type HttpResponse } from '../envelope';
import { parseJsonBody, requireString } from '../http';
import { resolveUserForIdentity } from '../services/identity';
import { issueSession } from '../services/session';

export function oauthStateKey(state: string): string {
  return `oauth_state:${state}`;
}

export function oauthPkceKey(state: string): string {
  return `oauth_pkce:${state}`;
}

interface PkceEntry {
  codeChallenge: string;
  method: string;
}

/** base64url-encode a buffer (no padding). */
function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Verify a PKCE code_verifier against the stored challenge (S256 or plain). */
function verifyPkce(codeVerifier: string, pkce: PkceEntry): boolean {
  if (pkce.method === 'S256') {
    const derived = base64url(createHash('sha256').update(codeVerifier).digest());
    return derived === pkce.codeChallenge;
  }
  // 'plain' fallback per RFC 7636.
  return codeVerifier === pkce.codeChallenge;
}

/**
 * Validate the CSRF state stored in Redis and delete it (single use).
 * Missing/expired -> VALIDATION_ERROR (400).
 */
async function consumeState(deps: AuthDeps, state: string): Promise<void> {
  const raw = await deps.redis.get(oauthStateKey(state));
  if (!raw) {
    throw new AppError('VALIDATION_ERROR', 'Invalid or expired state');
  }
  await deps.redis.del(oauthStateKey(state));
}

/** Shared tail: persist user + session + audit inside one transaction. */
async function completeLogin(
  deps: AuthDeps,
  provider: AuthProvider,
  profile: OAuthProfile,
  eventType: AuthEventType
): Promise<HttpResponse> {
  const result = await deps.db.transaction(async (repo) => {
    const { user } = await resolveUserForIdentity(deps, repo, provider, profile);
    await repo.setSessionContext({
      userId: user.id,
      role: user.role,
      patientId: user.linkedPatientId,
    });
    const session = await issueSession(deps, repo, user);
    return { user, session };
  });

  await deps.audit.write({
    eventType,
    userId: result.user.id,
    subjectRef: profile.providerSubject,
    occurredAt: deps.clock.now().toISOString(),
    detail: { provider },
  });

  deps.logger.info('auth.login.success', { provider, userId: result.user.id });

  return respondOk({
    sessionToken: result.session.sessionToken,
    expiresAt: result.session.expiresAt,
    user: { id: result.user.id, role: result.user.role, displayName: result.user.displayName },
  });
}

export async function handleGoogleCallback(
  deps: AuthDeps,
  req: AuthRequest
): Promise<HttpResponse> {
  const body = parseJsonBody(req);
  const code = requireString(body, 'code');
  const state = requireString(body, 'state');
  const redirectUri = requireString(body, 'redirect_uri');

  await consumeState(deps, state);

  const profile = await deps.google.exchangeAndVerify({ code, redirectUri });
  return completeLogin(deps, 'google', profile, 'AUTH_LOGIN_GOOGLE');
}

export async function handleXCallback(deps: AuthDeps, req: AuthRequest): Promise<HttpResponse> {
  const body = parseJsonBody(req);
  const code = requireString(body, 'code');
  const state = requireString(body, 'state');
  const codeVerifier = requireString(body, 'code_verifier');

  // CSRF state + PKCE: the state must exist AND the PKCE challenge must be
  // present for this state. Both are consumed (single-use).
  const pkceRaw = await deps.redis.get(oauthPkceKey(state));
  if (!pkceRaw) {
    throw new AppError('VALIDATION_ERROR', 'Invalid or expired state');
  }
  await consumeState(deps, state);
  await deps.redis.del(oauthPkceKey(state));

  const pkce = JSON.parse(pkceRaw) as PkceEntry;
  // Verify the PKCE code_verifier against the stored code_challenge (S256).
  // A mismatch is an auth failure -> UNAUTHENTICATED (401). The provider port
  // performs the authoritative upstream exchange after this local guard.
  if (!verifyPkce(codeVerifier, pkce)) {
    throw new AppError('UNAUTHENTICATED', 'PKCE verification failed');
  }

  const profile = await deps.x.exchangeAndVerify({ code, codeVerifier });
  return completeLogin(deps, 'x', profile, 'AUTH_LOGIN_X');
}
