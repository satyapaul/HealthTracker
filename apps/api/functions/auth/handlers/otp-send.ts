/**
 * POST /auth/otp/send — generate + send an OTP. No OTP/phone in logs/response.
 */
import type { AuthDeps } from '../deps';
import type { AuthRequest } from '../http';
import { AppError, respondOk, type HttpResponse } from '../envelope';
import { parseJsonBody, requireString } from '../http';
import { buildSmsMessage, enforceSendRateLimit, isE164, phoneRef } from '../services/otp';

export async function handleOtpSend(deps: AuthDeps, req: AuthRequest): Promise<HttpResponse> {
  const body = parseJsonBody(req);
  const phone = requireString(body, 'phone_number');

  if (!isE164(phone)) {
    throw new AppError('VALIDATION_ERROR', 'Phone number must be E.164 format', {
      field: 'phone_number',
    });
  }

  await enforceSendRateLimit(deps, phone);

  const now = deps.clock.now();
  const expiresAt = new Date(now.getTime() + deps.config.otpTtlSeconds * 1000);
  const code = deps.ids.otpCode();
  const otpHash = await deps.hasher.hash(code);
  const challengeId = deps.ids.uuid();

  await deps.db.transaction(async (repo) => {
    await repo.insertOtpChallenge({ id: challengeId, phoneNumber: phone, otpHash, expiresAt });
  });

  // Non-PHI SMS body: code + app name + validity only.
  await deps.sms.send({
    to: phone,
    message: buildSmsMessage(deps.config.appName, code, deps.config.otpTtlSeconds),
  });

  await deps.audit.write({
    eventType: 'AUTH_OTP_SENT',
    userId: null,
    subjectRef: phoneRef(phone),
    occurredAt: now.toISOString(),
    detail: { channel: 'sms' },
  });

  // Log opaque id only — never the phone or OTP.
  deps.logger.info('auth.otp.sent', { challengeId });

  return respondOk({
    challengeId,
    expiresAt: expiresAt.toISOString(),
    resendAfterSeconds: deps.config.otpResendAfterSeconds,
  });
}
