/**
 * POST /auth/otp/verify — verify an OTP and issue a session.
 *
 * Order of checks (LLD §3.1 errors):
 *  1. challenge missing              -> VALIDATION_ERROR (400)
 *  2. expired (now > expires_at)     -> OTP_EXPIRED (400)
 *  3. already at max attempts        -> invalidate -> OTP_MAX_ATTEMPTS (429)
 *  4. bcrypt mismatch                -> increment attempts -> INVALID_OTP (401)
 *     (if that increment hits max, the NEXT verify would be blocked)
 *  5. match                          -> mark verified, find-or-create user, session
 */
import type { AuthDeps } from '../deps';
import type { AuthRequest } from '../http';
import type { OAuthProfile } from '../ports/oauth';
import { AppError, respondOk, type HttpResponse } from '../envelope';
import { parseJsonBody, requireString } from '../http';
import { resolveUserForIdentity } from '../services/identity';
import { issueSession } from '../services/session';

export async function handleOtpVerify(deps: AuthDeps, req: AuthRequest): Promise<HttpResponse> {
  const body = parseJsonBody(req);
  const challengeId = requireString(body, 'challengeId');
  const otp = requireString(body, 'otp');

  const now = deps.clock.now();

  const result = await deps.db.transaction(async (repo) => {
    const challenge = await repo.findOtpChallenge(challengeId);
    if (!challenge) {
      throw new AppError('VALIDATION_ERROR', 'Unknown challenge', { field: 'challengeId' });
    }

    if (now.getTime() > challenge.expiresAt.getTime()) {
      throw new AppError('OTP_EXPIRED', 'OTP challenge has expired');
    }

    if (challenge.attempts >= deps.config.otpMaxAttempts) {
      await repo.invalidateOtpChallenge(challengeId);
      throw new AppError('OTP_MAX_ATTEMPTS', 'Maximum OTP attempts exceeded');
    }

    const matches = await deps.hasher.compare(otp, challenge.otpHash);
    if (!matches) {
      const attempts = await repo.incrementOtpAttempts(challengeId);
      if (attempts >= deps.config.otpMaxAttempts) {
        await repo.invalidateOtpChallenge(challengeId);
        throw new AppError('OTP_MAX_ATTEMPTS', 'Maximum OTP attempts exceeded');
      }
      throw new AppError('INVALID_OTP', 'Incorrect OTP');
    }

    await repo.markOtpVerified(challengeId, now);

    // Find-or-create the user by phone identity (provider 'sms').
    const profile: OAuthProfile = {
      providerSubject: challenge.phoneNumber,
      email: null,
      emailVerified: false,
      displayName: challenge.phoneNumber,
    };
    const { user } = await resolveUserForIdentity(deps, repo, 'sms', profile);
    await repo.setSessionContext({
      userId: user.id,
      role: user.role,
      patientId: user.linkedPatientId,
    });
    const session = await issueSession(deps, repo, user);
    return { user, session };
  });

  await deps.audit.write({
    eventType: 'AUTH_LOGIN_OTP',
    userId: result.user.id,
    occurredAt: now.toISOString(),
    detail: { provider: 'sms' },
  });

  deps.logger.info('auth.login.success', { provider: 'sms', userId: result.user.id });

  return respondOk({
    sessionToken: result.session.sessionToken,
    expiresAt: result.session.expiresAt,
    user: { id: result.user.id, role: result.user.role, displayName: result.user.displayName },
  });
}
